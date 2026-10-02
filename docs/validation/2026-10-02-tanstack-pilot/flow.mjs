import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
const root = process.cwd(),
  app = fs.readFileSync('/tmp/tanstack-pilot-path', 'utf8'),
  preset = process.argv[2] ?? 'android-phone';
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
const host = path.join(root, 'native/dist/arm64/rn-a11y-host');
const meta = {
  preset,
  startedAt: new Date().toISOString(),
  sourceAtStart: snapshot(),
  hostSha256: hash(fs.readFileSync(host)),
  assertions: [],
  observations: {}
};
const args = [path.join(root, 'packages/react-native-a11y-tree/src/cli.ts'), 'session', app + '/App.tsx', '--project-root', app, '--preset', preset, '--setup', app + '/pilot-fixtures.ts', '--no-cache', '--bytecode', 'off'];
if (process.argv.includes('--strict')) {
  args.push('--fail-on-fallback');
  const targets = ['KeyboardObserver', 'LinkingManager', 'turbo/RNCNetInfo', ...(preset === 'android-phone' ? ['StatusBarManager', 'AndroidProgressBar', 'AndroidSwipeRefreshLayout'] : ['ActivityIndicatorView', 'PullToRefreshView'])];
  for (const target of targets) args.push('--allow-fallback', target);
}
meta.args = args;
const child = spawn(process.execPath, args, {
  cwd: app,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    RN_A11Y_HOST_BIN: host
  },
  stdio: ['pipe', 'pipe', 'pipe']
});
const records = [],
  queue = [],
  waiters = [];
let stderr = '',
  bytes = 0,
  stopped = false;
child.stderr.on('data', b => {
  stderr += b;
  if (stderr.length > 8 * 1024 * 1024) child.kill('SIGKILL');
});
const exit = new Promise(resolve => child.once('close', (code, signal) => {
  stopped = true;
  resolve({
    code,
    signal
  });
  for (const w of waiters.splice(0)) w.reject(Error('CLI closed'));
}));
const lines = readline.createInterface({
  input: child.stdout
});
lines.on('line', s => {
  bytes += s.length;
  if (bytes > 64 * 1024 * 1024) {
    child.kill('SIGKILL');
    return;
  }
  let r;
  try {
    r = JSON.parse(s);
  } catch {
    child.kill('SIGKILL');
    return;
  }
  records.push(r);
  const waiter = waiters.shift();
  if (waiter) waiter.resolve(r);else queue.push(r);
});
function next() {
  if (queue.length) return Promise.resolve(queue.shift());
  if (stopped) return Promise.reject(Error('CLI already stopped'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('response deadline')), 30000);
    waiters.push({
      resolve: r => {
        clearTimeout(timer);
        resolve(r);
      },
      reject: e => {
        clearTimeout(timer);
        reject(e);
      }
    });
  });
}
let id = 0;
async function send(body) {
  const request = {
    id: ++id,
    ...body
  };
  child.stdin.write(JSON.stringify(request) + '\n');
  const r = await next();
  assert.equal(r.id, id);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert(!r.step?.error, JSON.stringify(r.step));
  return r;
}
function flat(n) {
  return [n, ...(n.children ?? []).flatMap(flat)];
}
function texts(t) {
  return flat(t).map(n => n.text).filter(Boolean);
}
function node(t, pred) {
  const n = flat(t).find(pred);
  assert(n, 'Required node absent');
  return n;
}
function check(label, condition) {
  assert(condition, label);
  meta.assertions.push(label);
}
const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
try {
  const ready = await next();
  assert.equal(ready.ready, true, JSON.stringify(ready));
  check('whole app initially loading, no Rush list row', !texts(ready.tree).includes('Rush'));
  meta.observations.loadingTypes = [...new Set(flat(ready.tree).map(n => n.type))];
  await send({
    action: {
      wait: 2500
    }
  });
  const list = (await send({
    tree: true
  })).tree;
  const movie = node(list, n => n.role === 'button' && n.name === 'Rush 2013');
  check('real movie list resolved', texts(list).includes('Prisoners'));
  meta.observations.movieControl = {
    ref: movie.ref,
    name: movie.name
  };
  await send({
    action: {
      tap: {
        ref: movie.ref
      }
    }
  });
  const partial = (await send({
    tree: true
  })).tree;
  const plot = JSON.parse(fs.readFileSync(app + '/src/data/movies.json'))[0].info.plot;
  check('navigation reached partial movie details', texts(partial).includes('Rush (2013)'));
  check('partial details have no plot yet', !texts(partial).includes(plot));
  await send({
    action: {
      wait: 2500
    }
  });
  const details = (await send({
    tree: true
  })).tree;
  check('full detail query resolved plot', texts(details).includes(plot));
  check('full detail query resolved actors', texts(details).includes('Daniel Bruhl, Chris Hemsworth or Olivia Wilde'));
  const back = node(details, n => n.role === 'button' && /back/i.test(n.name ?? ''));
  meta.observations.backControl = {
    ref: back.ref,
    name: back.name
  };
  await send({
    action: {
      tap: {
        ref: back.ref
      }
    }
  });
  await send({
    action: {
      wait: 2500
    }
  });
  const returned = (await send({
    tree: true
  })).tree;
  check('back returns to list', texts(returned).includes('Rush'));
  check('details removed after back', !texts(returned).includes('Rush (2013)'));
  const fetchLogs = records.flatMap(r => r.logs ?? []).filter(l => l.message.includes('fetchMovie'));
  meta.observations.queryLogs = fetchLogs;
  check('focus refetch invoked list query again', fetchLogs.filter(l => /fetchMovies/.test(l.message)).length >= 2);
  check('detail query invoked', fetchLogs.some(l => /fetchMovie[^s]/.test(l.message)));
  await send({
    quit: true
  });
  child.stdin.end();
  const status = await exit;
  assert.equal(status.code, 0);
  meta.status = status;
  meta.success = true;
} catch (e) {
  meta.success = false;
  meta.failure = String(e.stack ?? e);
  child.kill('SIGKILL');
  meta.status = await exit;
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  lines.close();
  meta.sourceAtEnd = snapshot();
  meta.sourceStable = meta.sourceAtStart.hash === meta.sourceAtEnd.hash;
  if (!meta.sourceStable) {
    meta.success = false;
    meta.failure = 'CLI/runtime source changed during flow';
    process.exitCode = 1;
  }
  meta.finishedAt = new Date().toISOString();
  meta.diagnostics = Object.values(Object.fromEntries(records.flatMap(r => r.diagnostics ?? []).map(d => [d.code + ':' + d.target, d])));
  meta.logs = records.flatMap(r => r.logs ?? []);
  meta.protocolErrors = records.filter(record => record.error).map(({id, ready, ok, error}) => ({id, ready, ok, error}));
  fs.writeFileSync('/tmp/tanstack-flow-' + preset + (process.argv.includes('--strict') ? '-strict' : '') + '.json', JSON.stringify(meta, null, 2));
  fs.writeFileSync('/tmp/tanstack-flow-' + preset + '.stderr', stderr);
  console.log(JSON.stringify({
    success: meta.success,
    failure: meta.failure,
    assertions: meta.assertions,
    diagnostics: meta.diagnostics,
    observations: meta.observations
  }));
}
