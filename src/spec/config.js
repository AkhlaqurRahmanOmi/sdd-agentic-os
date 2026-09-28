// A deliberately small YAML reader for .sdd/config.yaml.
//
// The plan calls for config.yaml and a YAML dependency is not worth carrying
// for a file this shape. This handles exactly what the config needs — scalars,
// one level of nesting, and simple lists — and throws on anything else rather
// than guessing. Silently mis-parsing config is worse than refusing to.

import { readFile } from 'node:fs/promises';
import { configPath } from './paths.js';

export const DEFAULT_CONFIG = {
  triage: {
    model: 'claude-haiku-4-5',
    // A "small" ticket whose diff exceeds either of these was misclassified.
    // Recorded so the thresholds can be tuned against reality rather than guessed twice.
    small_max_files: 2,
    small_max_lines: 50,
  },
  propose: { model: 'claude-opus-5' },
  tasks: { model: 'claude-sonnet-5' },
  budgets: { constitution_tokens: 1500 },
};

function coerce(raw) {
  const value = raw.trim();
  if (value === '') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d*\.\d+$/.test(value)) return Number.parseFloat(value);
  if (/^["'].*["']$/.test(value)) return value.slice(1, -1);
  return value;
}

export function parseConfig(text) {
  const out = {};
  let section = null;

  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, '').trimEnd();
    if (!line.trim() || line.trimStart().startsWith('#')) return;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    const where = `config.yaml:${i + 1}`;

    if (trimmed.startsWith('- ')) {
      if (!section || !Array.isArray(out[section])) {
        throw new Error(`${where}: list item outside a list`);
      }
      out[section].push(coerce(trimmed.slice(2)));
      return;
    }

    const kv = trimmed.match(/^([\w.-]+):\s*(.*)$/);
    if (!kv) throw new Error(`${where}: cannot parse ${JSON.stringify(trimmed)}`);
    const [, key, rest] = kv;

    if (indent === 0) {
      if (rest === '') {
        // A bare key opens either a nested map or a list; the next line decides.
        out[key] = {};
        section = key;
      } else {
        out[key] = coerce(rest);
        section = null;
      }
      return;
    }
    if (!section) throw new Error(`${where}: indented key with no parent`);
    if (Array.isArray(out[section])) throw new Error(`${where}: mixing a list and a map`);
    out[section][key] = coerce(rest);
  });

  return out;
}

function merge(base, override) {
  const out = { ...base };
  for (const [k, v] of Object.entries(override ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(base[k] ?? {}, v) : v;
  }
  return out;
}

export async function loadConfig(root = process.cwd()) {
  try {
    return merge(DEFAULT_CONFIG, parseConfig(await readFile(configPath(root), 'utf8')));
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULT_CONFIG };
    throw err;
  }
}

export function renderConfig(config = DEFAULT_CONFIG) {
  const lines = ['# sdd configuration. See docs/milestones.md for the phase plan.', ''];
  for (const [section, value] of Object.entries(config)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`${section}:`);
      for (const [k, v] of Object.entries(value)) lines.push(`  ${k}: ${v}`);
    } else {
      lines.push(`${section}: ${value}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
