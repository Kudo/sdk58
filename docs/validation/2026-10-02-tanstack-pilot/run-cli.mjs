import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = process.cwd(),
  app = fs.readFileSync('/tmp/tanstack-pilot-path', 'utf8');
const [label, ...extra] = process.argv.slice(2);
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function snapshot() {
  const files = {};
  function walk(p) {
    for (const e of fs.readdirSync(p, {
      withFileTypes: true
    }).sort((a, b) => a.name.localeCompare(b.name))) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) walk(f);else if (e.isFile()) files[path.relative(root, f)] = hash(fs.readFileSync(f));
    }
  }
  for (const p of ['src', 'runtime']) walk(path.join(root, 'packages/react-native-a11y-tree', p));
  return {
    head: spawnSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8'
    }).stdout.trim(),
    status: spawnSync('git', ['status', '--porcelain'], {
      encoding: 'utf8'
    }).stdout,
    hash: hash(JSON.stringify(files)),
    files
  };
}
const start = snapshot();
const host = path.join(root, 'native/dist/arm64/rn-a11y-host');
const args = [path.join(root, 'packages/react-native-a11y-tree/src/cli.ts'), ...extra.map(x => x.replaceAll('<APP>', app)), '--project-root', app, '--no-cache', '--bytecode', 'off'];
const at = Date.now();
const p = spawnSync(process.execPath, args, {
  cwd: app,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    RN_A11Y_HOST_BIN: host
  },
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  timeout: 120000,
  killSignal: 'SIGKILL'
});
const end = snapshot();
fs.writeFileSync('/tmp/tanstack-' + label + '.json', p.stdout ?? '');
fs.writeFileSync('/tmp/tanstack-' + label + '.stderr', p.stderr ?? '');
fs.writeFileSync('/tmp/tanstack-' + label + '.meta.json', JSON.stringify({
  args,
  status: p.status,
  signal: p.signal,
  error: p.error?.message,
  elapsedMs: Date.now() - at,
  hostSha256: hash(fs.readFileSync(host)),
  sourceAtStart: start,
  sourceAtEnd: end,
  sourceStable: start.hash === end.hash
}, null, 2));
console.log(JSON.stringify({
  label,
  status: p.status,
  error: p.error?.message,
  stderr: p.stderr?.slice(-1500),
  stdout: p.stdout?.slice(0, 1000)
}));
// This published helper verifies rejection; an unexpected success must fail it.
assert(extra.includes('--fail-on-fallback'), 'Expected a strict rejection command');
assert.equal(p.error, undefined, 'CLI subprocess failed');
assert.equal(p.signal, null, 'CLI subprocess was killed');
assert.equal(p.status, 6, 'Strict rejection must exit 6');
const result = JSON.parse(p.stdout);
assert.equal(result.error?.code, 'UNSUPPORTED_NATIVE');
assert(result.error.details.diagnostics.length > 0);
assert.equal(start.hash, end.hash, 'CLI/runtime source changed during verification');
console.log('Strict rejection verified');
