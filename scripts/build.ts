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
const licenses = ['commander', 'get-tsconfig', 'resolve-pkg-maps'].map(name =>
  `/*! Bundled ${name} license:\n${fs.readFileSync(path.join(ROOT, 'node_modules', name, 'LICENSE'), 'utf8')}*/`,
).join('\n');
const args = [
  'build',
  path.join(ROOT, 'packages/react-native-a11y-tree', 'src', 'cli.ts'),
  '--target',
  'node',
  '--format',
  'esm',
  '--banner',
  `#!/usr/bin/env node\n${licenses}`,
  '--outfile',
  path.join(DIST, 'rn-a11y-tree.js'),
];
const proc = spawnSync(process.execPath, args, {cwd: ROOT, stdio: 'inherit'});
if (proc.status !== 0) process.exit(proc.status ?? 1);
fs.chmodSync(path.join(DIST, 'rn-a11y-tree.js'), 0o755);

for (const [entry, output] of [['testing.ts', 'test.js'], ['testingConfig.ts', 'test-config.js']]) {
  const built = spawnSync(process.execPath, ['build', path.join(ROOT, 'packages/react-native-a11y-tree/src', entry),
    '--target', 'node', '--format', 'esm', '--external', 'vitest', '--external', 'vitest/config',
    '--outfile', path.join(DIST, output)], {cwd: ROOT, stdio: 'inherit'});
  if (built.status !== 0) process.exit(built.status ?? 1);
}
const types = spawnSync('node', [path.join(ROOT, 'node_modules/typescript/bin/tsc'),
  '-p', path.join(ROOT, 'packages/react-native-a11y-tree/tsconfig.test-types.json')], {cwd: ROOT, stdio: 'inherit'});
if (types.status !== 0) process.exit(types.status ?? 1);

// Keep the published documentation in sync with the repository.
for (const file of ['README.md', 'LICENSE']) {
  fs.copyFileSync(path.join(ROOT, file), path.join(ROOT, 'packages/react-native-a11y-tree', file));
}
