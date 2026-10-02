#!/usr/bin/env bun
/** Fresh processes only: cold render, unchanged cache hits, and verified source edits. */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const {values} = parseArgs({options: {
  app: {type: 'string', default: 'examples/medium/App.tsx'},
  iterations: {type: 'string', default: '5'},
  preset: {type: 'string', default: 'android-phone'},
  bytecode: {type: 'string', default: 'auto'},
  out: {type: 'string'},
}});
const iterations = Number(values.iterations);
if (!Number.isInteger(iterations) || iterations < 1) throw new Error('--iterations must be a positive integer');
const app = fs.realpathSync(path.resolve(values.app));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'packages/react-native-a11y-tree/src/cli.ts');
// An adjacent disposable entry inherits the app's package and module resolution.
// The original app is never edited. A visible revision verifies cache freshness.
const fixture = fs.mkdtempSync(path.join(path.dirname(app), '.agent-loop-'));
const entry = path.join(fixture, 'App.tsx');
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-agent-loop-'));
const relative = '../' + path.basename(app);
type Sample = {scenario: string; wallMs: number; outputBytes: number; timing: Record<string, unknown>};
const samples: Sample[] = [];
function edit(revision: number) {
  fs.writeFileSync(entry, `import React from 'react';\nimport {Text} from 'react-native';\nimport * as AppModule from ${JSON.stringify(relative)};\nconst App = AppModule.default ?? AppModule.App;\nexport default function Benchmark() {return <><App/><Text testID="benchmark-revision">revision-${revision}</Text></>;}\n`);
}
function run(scenario: string, revision: number) {
  const start = performance.now();
  const proc = spawnSync('node', [cli, 'render', entry, '--preset', values.preset!, '--format', 'compact',
    '--select', 'testID=benchmark-revision', '--timing', '--bytecode', values.bytecode!], {
    cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
    env: {...process.env, RN_A11Y_TREE_CACHE_DIR: cache},
  });
  const wallMs = performance.now() - start;
  if (proc.status !== 0) throw new Error(`${scenario} failed: ${proc.error ?? proc.stderr}`);
  const output = JSON.parse(proc.stdout);
  if (!output.matches.some((node: {text?: string}) => node.text === `revision-${revision}`)) {
    throw new Error(`${scenario}: stale/missing revision ${revision}`);
  }
  const timing = JSON.parse(proc.stderr.split('\n').find(line => line.startsWith('rn-a11y-tree timing: '))!.slice('rn-a11y-tree timing: '.length));
  const expected = scenario === 'unchanged' ? 'hit' : 'miss';
  if (timing.bundleCache !== expected) throw new Error(`${scenario}: expected cache ${expected}, got ${timing.bundleCache}`);
  samples.push({scenario, wallMs: Math.round(wallMs), outputBytes: Buffer.byteLength(proc.stdout), timing});
}
try {
  edit(0);
  run('cold', 0);
  for (let i = 0; i < iterations; i++) run('unchanged', 0);
  for (let i = 1; i <= iterations; i++) {edit(i); run('source-edit', i);}
  const summary = Object.fromEntries(['cold', 'unchanged', 'source-edit'].map(scenario => {
    const times = samples.filter(s => s.scenario === scenario).map(s => s.wallMs).sort((a, b) => a - b);
    return [scenario, {n: times.length, medianMs: times[Math.floor(times.length / 2)], minMs: times[0], maxMs: times.at(-1)}];
  }));
  const report = {app, preset: values.preset, bytecode: values.bytecode, timestamp: new Date().toISOString(),
    machine: {platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, node: spawnSync('node', ['--version'], {encoding: 'utf8'}).stdout.trim()},
    summary, samples};
  const json = JSON.stringify(report, null, 2) + '\n';
  if (values.out) fs.writeFileSync(values.out, json);
  process.stdout.write(json);
} finally {
  fs.rmSync(fixture, {recursive: true, force: true});
  // Auto bytecode compilation may still finish in this directory; its compiler
  // cannot publish into a removed entry. Cleanup errors must not hide a failure.
  fs.rmSync(cache, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
}
