#!/usr/bin/env bun
// Runs every test tree through the reference (swiftui-ref: real SwiftUI on macOS) and the C++
// engine (build/swiftui-layout, platform macos) and compares the frames.
//
//   bun native/tools/swiftui-layout-test/compare.ts [--platform macos|ios] [--tolerance 0.5]
//        [--verbose] [--summary] [filter]
//
// Trees: native/tools/swiftui-ref/examples/*.json and native/tools/swiftui-layout-test/cases/*.json.
// Run build.sh first. Exit code 1 if any tree differs.
//
// --platform ios: the reference is real SwiftUI on the iOS simulator (swiftui-ref/scripts/run-ios.sh,
// all trees in one launch, ~25 s), the engine runs with ControlMetrics::ios(). Text is still
// measured with macOS fonts, so text-heavy trees can differ by a pixel or two.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const refBin = path.join(here, '../swiftui-ref/.build/release/swiftui-ref');
const engineBin = path.join(here, 'build/swiftui-layout');

type Rect = { x: number; y: number; width: number; height: number };
type LayoutNode = { path: string; type: string; frame?: Rect; contentFrame?: Rect };
type LayoutResult = {
  host: { width: number; height: number; x?: number; y?: number };
  nodes: LayoutNode[];
  unsupported?: Record<string, unknown>;
};

const args = process.argv.slice(2);
let tolerance = 0.5;
let verbose = false;
let summary = false;
let platform = 'macos';
let filter: string | null = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tolerance') tolerance = Number(args[++i]);
  else if (args[i] === '--platform') platform = args[++i];
  else if (args[i] === '--verbose' || args[i] === '-v') verbose = true;
  else if (args[i] === '--summary') summary = true;
  else filter = args[i];
}

const files = [
  ...fs.readdirSync(path.join(here, '../swiftui-ref/examples')).map((f) => path.join(here, '../swiftui-ref/examples', f)),
  ...fs.readdirSync(path.join(here, 'cases')).map((f) => path.join(here, 'cases', f)),
]
  .filter((f) => f.endsWith('.json'))
  .filter((f) => !filter || f.includes(filter))
  .sort();

const run = (bin: string, input: string, extra: string[] = []): LayoutResult =>
  JSON.parse(execFileSync(bin, extra, { input, encoding: 'utf8' }));

function diffRect(label: string, a: Rect | undefined, b: Rect | undefined): string[] {
  if (!a && !b) return [];
  if (!a || !b) return [`${label}: ref ${JSON.stringify(a)} engine ${JSON.stringify(b)}`];
  const out: string[] = [];
  for (const k of ['x', 'y', 'width', 'height'] as const) {
    if (Math.abs(a[k] - b[k]) > tolerance) out.push(`${label}.${k}: ref ${a[k]} engine ${b[k]}`);
  }
  return out;
}

let iosRefs: Record<string, LayoutResult> | null = null;
if (platform === 'ios') {
  const out = path.join(here, 'build/ios-reference.json');
  execFileSync(path.join(here, '../swiftui-ref/scripts/run-ios.sh'), [out, ...files], { stdio: 'inherit' });
  iosRefs = JSON.parse(fs.readFileSync(out, 'utf8'));
}

let passed = 0;
const failures: { name: string; problems: string[] }[] = [];
for (const file of files) {
  const input = fs.readFileSync(file, 'utf8');
  const ref = iosRefs ? iosRefs[path.resolve(file)] : run(refBin, input);
  const engine = run(engineBin, input, ['--platform', platform]);
  const problems: string[] = [];
  problems.push(...diffRect('host', { x: 0, y: 0, ...ref.host }, { x: 0, y: 0, ...engine.host }));
  const refNodes = new Map(ref.nodes.map((n) => [n.path, n]));
  const engineNodes = new Map(engine.nodes.map((n) => [n.path, n]));
  for (const [p, r] of refNodes) {
    const e = engineNodes.get(p);
    if (!e) {
      problems.push(`${p} ${r.type}: missing in engine`);
      continue;
    }
    const d = [
      ...diffRect(`${p} ${r.type} frame`, r.frame, e.frame),
      ...diffRect(`${p} ${r.type} contentFrame`, r.contentFrame ?? r.frame, e.contentFrame ?? e.frame),
    ];
    problems.push(...d);
  }
  for (const [p, e] of engineNodes) {
    if (!refNodes.has(p)) problems.push(`${p} ${e.type}: extra in engine`);
  }
  const name = path.relative(path.join(here, '..'), file);
  if (problems.length === 0) {
    passed++;
    if (verbose) console.log(`ok   ${name}`);
  } else {
    failures.push({ name, problems });
    console.log(`FAIL ${name} (${problems.length})`);
    if (!summary) {
      for (const p of problems.slice(0, verbose ? 1000 : 8)) console.log(`       ${p}`);
      if (!verbose && problems.length > 8) console.log(`       ... ${problems.length - 8} more`);
    }
  }
}
console.log(`\n${platform}: ${passed}/${files.length} trees match within ${tolerance} pt`);
process.exit(failures.length ? 1 : 0);
