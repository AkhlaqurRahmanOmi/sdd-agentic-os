import { SKILLS, renderAgentsMd, renderSkill } from '../dist/templates.js';
import { formatInstall, readManifest, writeGenerated, writeManifest } from '../dist/manifest.js';
import { parseArgs } from './cost.js';

// The generic floor every AGENTS.md-reading harness uses, plus one adapter per
// harness that does not read it.
//
// The adapter is not optional for Claude Code: it discovers .claude/skills/
// and does not read .agents/skills/ at all. That was verified by running the
// CLI and reading the skills it reported, not assumed from the convention.
export const TARGETS = {
  generic: { label: 'AGENTS.md + .agents/skills/', skillDir: '.agents/skills' },
  claude: { label: 'Claude Code', skillDir: '.claude/skills' },
  // Codex reads the repository's AGENTS.md; its skills are user-level
  // (~/.codex/skills), with no project-level skills directory. Writing
  // .codex/skills/ generated files nothing reads — the same mistake as
  // assuming .agents/skills/ was a universal floor. AGENTS.md is written for
  // every target, so this one needs no directory of its own.
  codex: { label: 'Codex (AGENTS.md only)', skillDir: null },
};

export async function installCommand(
  argv,
  { root = process.cwd(), stdout = process.stdout } = {},
) {
  const { flags } = parseArgs(argv);
  const requested =
    typeof flags.targets === 'string'
      ? flags.targets.split(',').map((t) => t.trim()).filter(Boolean)
      : ['generic', 'claude'];

  for (const target of requested) {
    if (!TARGETS[target]) {
      throw new Error(`unknown target "${target}" — known: ${Object.keys(TARGETS).join(', ')}`);
    }
  }

  const manifest = await readManifest(root);
  const results = [];

  results.push(await writeGenerated('AGENTS.md', renderAgentsMd(), { root, manifest }));
  for (const target of requested) {
    const { skillDir } = TARGETS[target];
    if (!skillDir) continue;
    for (const skill of SKILLS) {
      results.push(
        await writeGenerated(`${skillDir}/${skill.name}/SKILL.md`, renderSkill(skill), {
          root,
          manifest,
        }),
      );
    }
  }

  await writeManifest(manifest, root);
  stdout.write(
    `installed for: ${requested.map((t) => TARGETS[t].label).join(', ')}\n${formatInstall(results)}`,
  );

  const conflicts = results.filter((r) => r.action === 'conflict' || r.action === 'foreign');
  if (conflicts.length) {
    stdout.write(
      '\nNothing you edited was overwritten. Merge the .incoming files and\n' +
        're-run `sdd install` to adopt the result.\n',
    );
  }
  return 0;
}
