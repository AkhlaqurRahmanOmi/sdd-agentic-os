// Parses a `claude --output-format stream-json` event stream into a run summary.
//
// Only two event types carry what Phase 0 needs:
//   system/init  -> model, session id
//   result       -> usage, cost, turns, wall time, error state
// Files read are not reported anywhere, so they are counted from the `tool_use`
// blocks inside `assistant` events.

const READ_TOOLS = new Set(['Read', 'NotebookRead']);

export function createStreamParser() {
  const filesRead = [];
  const state = { model: null, sessionId: null, result: null, readCalls: 0 };

  function handle(event) {
    if (event.type === 'system' && event.subtype === 'init') {
      state.model = event.model ?? null;
      state.sessionId = event.session_id ?? null;
      return;
    }
    if (event.type === 'assistant') {
      // `<synthetic>` is what the CLI reports for locally generated error
      // messages; it is not a model that ran, so don't let it overwrite init.
      const model = event.message?.model;
      if (model && model !== '<synthetic>') state.model = model;
      for (const block of event.message?.content ?? []) {
        if (block?.type !== 'tool_use' || !READ_TOOLS.has(block.name)) continue;
        state.readCalls += 1;
        const path = block.input?.file_path ?? block.input?.notebook_path;
        if (typeof path === 'string') filesRead.push(path);
      }
      return;
    }
    if (event.type === 'result') state.result = event;
  }

  return {
    handle,
    // A line that isn't JSON is not an error: the CLI interleaves plain
    // diagnostics on stdout. Skip it rather than failing the whole run.
    handleLine(line) {
      const trimmed = line.trim();
      if (!trimmed) return;
      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (event && typeof event === 'object') handle(event);
    },
    summarize() {
      const r = state.result;
      if (!r) return null;
      const u = r.usage ?? {};
      return {
        model: state.model,
        sessionId: state.sessionId ?? r.session_id ?? null,
        tokens: {
          input: u.input_tokens ?? 0,
          cache_read: u.cache_read_input_tokens ?? 0,
          cache_write: u.cache_creation_input_tokens ?? 0,
          output: u.output_tokens ?? 0,
          thinking: u.output_tokens_details?.thinking_tokens ?? 0,
        },
        costUsd: r.total_cost_usd ?? null,
        wallMs: r.duration_ms ?? null,
        apiMs: r.duration_api_ms ?? null,
        turns: r.num_turns ?? null,
        readCalls: state.readCalls,
        filesRead: [...new Set(filesRead)].sort(),
        // `subtype` reads "success" even on a failed run, so `is_error` is the
        // only field that actually says whether the run worked.
        ok: r.is_error !== true,
        terminalReason: r.terminal_reason ?? null,
        modelUsage: r.modelUsage ?? {},
      };
    },
  };
}

export function parseStream(text) {
  const parser = createStreamParser();
  for (const line of text.split('\n')) parser.handleLine(line);
  return parser.summarize();
}
