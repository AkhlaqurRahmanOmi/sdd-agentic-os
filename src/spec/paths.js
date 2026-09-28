import path from 'node:path';

export const SDD_DIR = '.sdd';

export const sddDir = (root = process.cwd()) => path.join(root, SDD_DIR);
export const configPath = (root) => path.join(sddDir(root), 'config.yaml');
export const constitutionPath = (root) => path.join(sddDir(root), 'constitution.md');
export const changesDir = (root) => path.join(sddDir(root), 'changes');
export const changeDir = (id, root) => path.join(changesDir(root), id);

export const requirementsPath = (id, root) => path.join(changeDir(id, root), 'requirements.md');
export const tasksIndexPath = (id, root) => path.join(changeDir(id, root), 'tasks.md');
export const taskCardsDir = (id, root) => path.join(changeDir(id, root), 'tasks');
export const taskCardPath = (id, taskId, root) => path.join(taskCardsDir(id, root), `${taskId}.md`);
export const statePath = (id, root) => path.join(changeDir(id, root), 'state.md');
export const evidencePath = (id, root) => path.join(changeDir(id, root), 'evidence.md');
