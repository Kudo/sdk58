#!/usr/bin/env bun
/**
 * `bun run build` (also run by `prepack`): dist/rn-a11y-tree.js, one ES
 * module for Node from src/cli.ts, including Commander and runtime resolution.
 * A script rather than a shell one-liner so npm can run it under cmd.exe too.
 */

import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'packages/react-native-a11y-tree', 'dist');

fs.rmSync(DIST, {recursive: true, force: true});
const args = [
  'build',
  path.join(ROOT, 'packages/react-native-a11y-tree', 'src', 'cli.ts'),
  '--target',
  'node',
  '--format',
  'esm',
  '--banner',
  `#!/usr/bin/env node\n/*! Bundled Commander.js license:\n${fs.readFileSync(path.join(ROOT, 'node_modules', 'commander', 'LICENSE'), 'utf8')}*/`,
  '--outfile',
  path.join(DIST, 'rn-a11y-tree.js'),
];
const proc = spawnSync(process.execPath, args, {cwd: ROOT, stdio: 'inherit'});
if (proc.status !== 0) process.exit(proc.status ?? 1);
fs.chmodSync(path.join(DIST, 'rn-a11y-tree.js'), 0o755);

// Keep the published documentation in sync with the repository.
for (const file of ['README.md', 'LICENSE']) {
  fs.copyFileSync(path.join(ROOT, file), path.join(ROOT, 'packages/react-native-a11y-tree', file));
}
