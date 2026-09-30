#!/usr/bin/env node
// Runtime performance measurements for rn-a11y-tree (docs/perf-analysis.md).
//
//   node scripts/perf.mjs [--n 5] [--app examples/medium/App.tsx]
//     [--script examples/medium/actions.json] [--label debug] [--out file.json]
//
// Scenarios (N iterations each): render with a cold Metro cache
// (--reset-cache), render warm, run warm, session (start + 12 requests +
// quit), and render warm with --no-mounted / --debug-props (getA11yTree
// cost). For every iteration: wall time, user+sys CPU of the CLI process
// tree (/usr/bin/time -l, which includes waited-for children such as the
// host), peak RSS of the host process and of the whole tree (ps sampling
// every 50 ms), and the phase timings printed by --timing.
// No dependencies; macOS (/usr/bin/time -l output format).

import {spawn, execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'rn-a11y-tree.js');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const N = Number(arg('n', '5'));
const APP = path.resolve(ROOT, arg('app', 'examples/medium/App.tsx'));
const SCRIPT = path.resolve(ROOT, arg('script', 'examples/medium/actions.json'));
const LABEL = arg('label', 'host');
const OUT = arg('out', null);
const PLATFORM = ['--platform', 'android'];
const HOST_NAME = 'rn-a11y-host';

// --- process tree sampling ----------------------------------------------------

function snapshotProcesses() {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,comm='], {encoding: 'utf8'});
  return out
    .trim()
    .split('\n')
    .map(line => {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      return m && {pid: +m[1], ppid: +m[2], rssKb: +m[3], comm: m[4]};
    })
    .filter(Boolean);
}

/** Samples the tree under `rootPid` every 50 ms; returns a stop() -> peaks. */
function sampleTree(rootPid) {
  let peakTotalKb = 0;
  let peakHostKb = 0;
  const tick = () => {
    let procs;
    try {
      procs = snapshotProcesses();
    } catch {
      return;
    }
    const children = new Map();
    for (const p of procs) {
      if (!children.has(p.ppid)) children.set(p.ppid, []);
      children.get(p.ppid).push(p);
    }
    let total = 0;
    let host = 0;
    const stack = [...(children.get(rootPid) ?? [])];
    const self = procs.find(p => p.pid === rootPid);
    if (self) total += self.rssKb;
    while (stack.length > 0) {
      const p = stack.pop();
      total += p.rssKb;
      if (path.basename(p.comm) === HOST_NAME) host += p.rssKb;
      stack.push(...(children.get(p.pid) ?? []));
    }
    peakTotalKb = Math.max(peakTotalKb, total);
    peakHostKb = Math.max(peakHostKb, host);
  };
  const timer = setInterval(tick, 50);
  tick();
  return () => {
    clearInterval(timer);
    return {peakTotalMb: peakTotalKb / 1024, peakHostMb: peakHostKb / 1024};
  };
}

// --- running the CLI -----------------------------------------------------------

function parseTimeL(stderr) {
  const num = re => {
    const m = stderr.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    userS: num(/([\d.]+)\s+user/),
    sysS: num(/([\d.]+)\s+sys/),
    maxRssBytes: num(/(\d+)\s+maximum resident set size/),
  };
}

function parseTimings(stderr) {
  return stderr
    .split('\n')
    .filter(l => l.includes('rn-a11y-tree timing: '))
    .map(l => JSON.parse(l.slice(l.indexOf('rn-a11y-tree timing: ') + 21)));
}

/** Runs the CLI under /usr/bin/time -l; optional line-based stdin driver. */
function runCli(cliArgs, {driver} = {}) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn('/usr/bin/time', ['-l', process.execPath, CLI, ...cliArgs], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stop = sampleTree(child.pid);
    let stdoutBytes = 0;
    let stderr = '';
    child.stderr.on('data', d => (stderr += d));
    if (driver) {
      driver(child).catch(reject);
    } else {
      child.stdin.end();
      child.stdout.on('data', d => (stdoutBytes += d.length));
    }
    child.on('close', code => {
      const wallMs = performance.now() - start;
      const peaks = stop();
      if (code !== 0) {
        reject(new Error(`CLI exited with ${code}:\n${stderr.slice(-2000)}`));
        return;
      }
      const t = parseTimeL(stderr);
      resolve({
        wallMs,
        cpuMs: ((t.userS ?? 0) + (t.sysS ?? 0)) * 1000,
        maxRssCliTreeMb: t.maxRssBytes != null ? t.maxRssBytes / 1024 / 1024 : null,
        ...peaks,
        timings: parseTimings(stderr),
        stdoutBytes,
      });
    });
  });
}

/** Session driver: waits for ready, sends requests one by one, then quit. */
function sessionDriver(requests, latencies) {
  return async child => {
    const lines = readline.createInterface({input: child.stdout})[Symbol.asyncIterator]();
    const next = async () => {
      const {value, done} = await lines.next();
      if (done) throw new Error('session ended early');
      return JSON.parse(value);
    };
    const ready = await next();
    if (!ready.ready) throw new Error(`session not ready: ${JSON.stringify(ready)}`);
    for (const req of requests) {
      const t0 = performance.now();
      child.stdin.write(JSON.stringify(req) + '\n');
      const res = await next();
      const kind = req.action != null ? Object.keys(req.action)[0] : 'tree';
      latencies.push({id: req.id, kind, ms: performance.now() - t0, ok: res.ok});
    }
    child.stdin.write(JSON.stringify({id: 'quit', quit: true}) + '\n');
    await next();
    child.stdin.end();
    for await (const _ of lines) {
      // drain
    }
  };
}

// --- scenarios --------------------------------------------------------------------

function sessionRequests() {
  const actions = JSON.parse(fs.readFileSync(SCRIPT, 'utf8'));
  const requests = actions.slice(0, 11).map((action, i) => ({id: i + 1, action}));
  requests.push({id: 12, tree: true});
  return requests;
}

const scenarios = [
  {name: 'render-cold', args: ['render', APP, ...PLATFORM, '--timing', '--reset-cache']},
  {name: 'render-warm', args: ['render', APP, ...PLATFORM, '--timing']},
  {name: 'run-warm', args: ['run', APP, ...PLATFORM, '--timing', '--script', SCRIPT]},
  {name: 'session', args: ['session', APP, ...PLATFORM, '--timing'], session: true},
  {name: 'render-no-mounted', args: ['render', APP, ...PLATFORM, '--timing', '--no-mounted']},
  {name: 'render-debug-props', args: ['render', APP, ...PLATFORM, '--timing', '--debug-props']},
];

function stats(values) {
  const v = values.filter(x => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return {median, min: v[0], max: v[v.length - 1]};
}

async function main() {
  const machine = {
    cpu: execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], {encoding: 'utf8'}).trim(),
    cores: os.cpus().length,
    memGb: Math.round(os.totalmem() / 2 ** 30),
    node: process.version,
    macos: execFileSync('sw_vers', ['-productVersion'], {encoding: 'utf8'}).trim(),
    hostBinary: fs.statSync(path.join(ROOT, 'native', 'dist', 'arm64', HOST_NAME)).size,
  };
  console.error(`machine: ${JSON.stringify(machine)}`);

  // Warm-up (fills the Metro cache, OS file cache).
  await runCli(['render', APP, ...PLATFORM]);

  const results = {label: LABEL, n: N, machine, scenarios: {}};
  for (const scenario of scenarios) {
    const runs = [];
    for (let i = 0; i < N; i++) {
      const latencies = [];
      const r = await runCli(
        scenario.args,
        scenario.session ? {driver: sessionDriver(sessionRequests(), latencies)} : {},
      );
      if (scenario.session) r.latencies = latencies;
      runs.push(r);
      console.error(`${scenario.name} #${i + 1}: ${Math.round(r.wallMs)} ms`);
    }
    results.scenarios[scenario.name] = runs;
  }

  // Summary: median/min/max per metric.
  const summary = {};
  for (const [name, runs] of Object.entries(results.scenarios)) {
    const first = t => runs.map(r => t(r));
    const timing = key => first(r => r.timings[0]?.[key]);
    const js = key => first(r => r.timings[0]?.js?.[key]);
    summary[name] = {
      wallMs: stats(first(r => r.wallMs)),
      cpuMs: stats(first(r => r.cpuMs)),
      peakHostMb: stats(first(r => r.peakHostMb)),
      peakTotalMb: stats(first(r => r.peakTotalMb)),
      maxRssCliTreeMb: stats(first(r => r.maxRssCliTreeMb)),
      metroMs: stats(timing('metroMs')),
      hostStartupMs: stats(first(r => r.timings[0]?.hostStartupMs)),
      hostSpawnToResultMs: stats(timing('hostSpawnToResultMs').map((v, i) => v ?? runs[i].timings[0]?.hostSpawnToReadyMs)),
      evalMs: stats(js('evalMs')),
      renderMs: stats(js('renderMs')),
      settleMs: stats(js('settleMs')),
      actionsMs: stats(js('actionsMs')),
      dumpMs: stats(js('dumpMs')),
      convertMs: stats(timing('convertMs')),
      outputBytes: stats(timing('outputBytes')),
      bundleBytes: stats(timing('bundleBytes')),
      requestMs: runs[0].latencies ? stats(runs.flatMap(r => r.latencies.map(l => l.ms))) : null,
      requestServerMs: runs[0].latencies
        ? stats(runs.flatMap(r => r.timings.filter(t => t.requestMs != null && t.id !== 'quit').map(t => t.requestMs)))
        : null,
    };
  }
  results.summary = summary;

  const text = JSON.stringify(results, null, 2);
  if (OUT) fs.writeFileSync(path.resolve(ROOT, OUT), text + '\n');
  printTable(summary);
}

function fmt(s, digits = 0) {
  if (s == null) return '-';
  const f = x => x.toFixed(digits);
  return `${f(s.median)} (${f(s.min)}–${f(s.max)})`;
}

function printTable(summary) {
  const rows = [
    ['total wall ms', 'wallMs'],
    ['CPU ms (user+sys, tree)', 'cpuMs'],
    ['peak RSS host MB', 'peakHostMb'],
    ['peak RSS tree MB', 'peakTotalMb'],
    ['Metro bundle ms', 'metroMs'],
    ['host startup ms', 'hostStartupMs'],
    ['host spawn→result ms', 'hostSpawnToResultMs'],
    ['bundle eval ms', 'evalMs'],
    ['first render ms', 'renderMs'],
    ['settle ms', 'settleMs'],
    ['actions ms', 'actionsMs'],
    ['getA11yTree ms', 'dumpMs'],
    ['JSON convert ms', 'convertMs'],
    ['session request ms (client)', 'requestMs'],
  ];
  const names = Object.keys(summary);
  console.log(`| metric (median, min–max) | ${names.join(' | ')} |`);
  console.log(`| --- | ${names.map(() => '---').join(' | ')} |`);
  for (const [label, key] of rows) {
    const digits = key.endsWith('Mb') ? 0 : ['dumpMs', 'renderMs', 'convertMs'].includes(key) ? 1 : 0;
    console.log(`| ${label} | ${names.map(n => fmt(summary[n][key], digits)).join(' | ')} |`);
  }
  const any = summary[names[0]];
  console.log(`\noutput bytes (render): ${any.outputBytes?.median}; bundle bytes: ${any.bundleBytes?.median}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
