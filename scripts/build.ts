#!/usr/bin/env bun
/**
 * `bun run build` (also run by `prepack`): dist/rn-a11y-tree.js, one ES
 * module for Node from src/cli.ts. A script rather than a shell one-liner so
 * that npm can run it under cmd.exe on Windows too.
 */

import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

fs.rmSync(DIST, {recursive: true, force: true});
const args = [
  'build',
  path.join(ROOT, 'src', 'cli.ts'),
  '--target',
  'node',
  '--format',
  'esm',
  '--packages',
  'external',
  '--banner',
  '#!/usr/bin/env node',
  '--outfile',
  path.join(DIST, 'rn-a11y-tree.js'),
];
const proc = spawnSync(process.execPath, args, {cwd: ROOT, stdio: 'inherit'});
process.exit(proc.status ?? 1);
