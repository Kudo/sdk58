// Run from the CLI repository root. Downloads the complete pinned example and
// installs only in a new temporary app. Leaves its path for flow.mjs/run-cli.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const report = path.dirname(fileURLToPath(import.meta.url));
const revision = '29859ae60c8dca0a5cdbf8abccc775b655cf43e2';
const prefix = 'examples/react/react-native/';
const app = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tanstack-pilot-')));
async function get(url) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(30000)
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
const tree = JSON.parse(await get(`https://api.github.com/repos/TanStack/query/git/trees/${revision}?recursive=1`));
assert(!tree.truncated);
const files = tree.tree.filter(f => f.type === 'blob' && f.path.startsWith(prefix));
assert.equal(files.length, 26);
const license = tree.tree.find(f => f.path === 'LICENSE');
assert(license);
await Promise.all([...files, license].map(async f => {
  const bytes = await get(`https://raw.githubusercontent.com/TanStack/query/${revision}/${f.path}`);
  const blobHash = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(blobHash, f.sha);
  const local = f === license ? 'UPSTREAM-LICENSE' : f.path.slice(prefix.length);
  fs.mkdirSync(path.dirname(path.join(app, local)), {
    recursive: true
  });
  fs.writeFileSync(path.join(app, local), bytes);
}));
for (const [src, dst] of [['app-package.json', 'package.json'], ['app-package-lock.json', 'package-lock.json'], ['pilot-fixtures.ts', 'pilot-fixtures.ts']]) fs.copyFileSync(path.join(report, src), path.join(app, dst));
fs.writeFileSync('/tmp/tanstack-pilot-path', app);
const log = fs.openSync('/tmp/tanstack-pilot-reproduction-install.log', 'w');
const result = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'], {
  cwd: app,
  stdio: ['ignore', log, log],
  timeout: 240000,
  killSignal: 'SIGKILL'
});
fs.closeSync(log);
assert.equal(result.status, 0, JSON.stringify({
  status: result.status,
  signal: result.signal,
  error: result.error?.message,
  log: '/tmp/tanstack-pilot-reproduction-install.log'
}));
console.log(app);
