#!/usr/bin/env node
// Spawns a grandchild that holds stdout open, then never exits — the shape
// that made `sdd doctor` hang: signalling the wrapper left the grandchild alive.
import { spawn } from 'node:child_process';
spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'ignore'] });
setInterval(() => {}, 1000);
