import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { changeDir } from '../spec/paths.js';
import { parseArgs } from './cost.js';

export const requireFlag = { parse: (argv) => parseArgs(argv).flags };

export function requireString(flags, name) {
  const value = flags[name];
  if (typeof value !== 'string' || !value) throw new Error(`--${name} is required`);
  return value;
}

// A ticket comes from --ticket <file>, or from the change directory once
// triage has scaffolded it.
export async function readTicket(flags, root) {
  if (typeof flags.ticket === 'string') return readFile(flags.ticket, 'utf8');
  if (typeof flags.id === 'string') {
    return readFile(path.join(changeDir(flags.id, root), 'ticket.md'), 'utf8');
  }
  throw new Error('--ticket <file> is required (or --id, once triage has scaffolded it)');
}

export async function readIfPresent(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}
