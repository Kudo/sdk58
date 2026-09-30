#!/usr/bin/env bun
// Runs every test tree through the reference (compose-ref: real Compose Desktop) and the C++
// engine (build/compose-layout) at density 1 and 2.75 and compares the frames in px.
//
//   bun native/tools/compose-layout-test/compare.ts [--tolerance 1] [--densities 1,2.75] [--verbose] [filter]
//
// Trees: native/tools/compose-ref/examples/*.json and native/tools/compose-layout-test/cases/*.json.
// Run build.sh first. compose-ref results are cached in build/ref-cache (keyed by the input, the
// arguments and the compose-ref build). Exit code 1 if any tree differs.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const refDir = path.join(here, '../compose-ref');
const refBin = path.join(refDir, 'compose-ref');
const engineBin = path.join(here, 'build/compose-layout');
const cacheDir = path.join(here, 'build/ref-cache');

type Rect = { x: number; y: number; width: number; height: number };
type LayoutNode = { path: string; type: string; frame?: Rect; contentFrame?: Rect };
type LayoutResult = {
  host: { width: number; height: number; x?: number; y?: number };
  nodes: LayoutNode[];
  unsupported?: Record<string, unknown>;
};

const args = process.argv.slice(2);
let tolerance = 1;
let verbose = false;
let filter: string | null = null;
let densities = [1, 2.75];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tolerance') tolerance = Number(args[++i]);
  else if (args[i] === '--densities') densities = args[++i].split(',').map(Number);
  else if (args[i] === '--verbose' || args[i] === '-v') verbose = true;
  else filter = args[i];
}

const files = [
  ...fs.readdirSync(path.join(refDir, 'examples')).map((f) => path.join(refDir, 'examples', f)),
  ...fs.readdirSync(path.join(here, 'cases')).map((f) => path.join(here, 'cases', f)),
]
  .filter((f) => f.endsWith('.json'))
  .filter((f) => !filter || f.includes(filter))
  .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

// Build compose-ref once (the wrapper rebuilds when the sources change).
execFileSync(refBin, [], { input: '{"root":{"type":"Spacer"}}', stdio: ['pipe', 'ignore', 'inherit'] });
const refJar = path.join(refDir, 'build/install/compose-ref/lib/compose-ref.jar');
const refStamp = fs.statSync(refJar).mtimeMs.toString();

function runRef(input: string, extra: string[]): LayoutResult {
  const key = crypto.createHash('sha1').update(refStamp).update(JSON.stringify(extra)).update(input).digest('hex');
  const file = path.join(cacheDir, `${key}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = execFileSync(refBin, extra, { input, encoding: 'utf8' });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, out);
  return JSON.parse(out);
}

const runEngine = (input: string, extra: string[]): LayoutResult =>
  JSON.parse(execFileSync(engineBin, extra, { input, encoding: 'utf8' }));

function diffRect(label: string, a: Rect | undefined, b: Rect | undefined, density: number): string[] {
  if (!a && !b) return [];
  if (!a || !b) return [`${label}: ref ${JSON.stringify(a)} engine ${JSON.stringify(b)}`];
  const out: string[] = [];
  for (const k of ['x', 'y', 'width', 'height'] as const) {
    const ra = a[k] * density;
    const rb = b[k] * density;
    if (Math.abs(ra - rb) > tolerance + 0.01) out.push(`${label}.${k}: ref ${+ra.toFixed(2)}px engine ${+rb.toFixed(2)}px`);
  }
  return out;
}

const configs = densities.map((density) => ({
  name: `d${density}`,
  args: density === 1 ? [] : ['--density', String(density)],
  density,
}));

const rows: { name: string; results: Record<string, string[]> }[] = [];
let failed = 0;
for (const file of files) {
  const input = fs.readFileSync(file, 'utf8');
  const extra: string[] = JSON.parse(input).args ?? [];
  const row: (typeof rows)[number] = { name: path.basename(file, '.json'), results: {} };
  for (const config of configs) {
    const argv = [...extra, ...config.args];
    const ref = runRef(input, argv);
    const engine = runEngine(input, argv);
    const d = config.density;
    const problems: string[] = [];
    problems.push(...diffRect('host', { x: 0, y: 0, ...ref.host }, { x: 0, y: 0, ...engine.host }, d));
    const refNodes = new Map(ref.nodes.map((n) => [n.path, n]));
    const engineNodes = new Map(engine.nodes.map((n) => [n.path, n]));
    for (const [p, r] of refNodes) {
      const e = engineNodes.get(p);
      if (!e) {
        problems.push(`${p} ${r.type}: missing in engine`);
        continue;
      }
      problems.push(...diffRect(`${p} ${r.type} frame`, r.frame, e.frame, d));
      problems.push(...diffRect(`${p} ${r.type} contentFrame`, r.contentFrame ?? r.frame, e.contentFrame ?? e.frame, d));
    }
    for (const [p, e] of engineNodes) {
      if (!refNodes.has(p)) problems.push(`${p} ${e.type}: only in engine`);
    }
    const ru = JSON.stringify(Object.keys(ref.unsupported ?? {}).sort());
    const eu = JSON.stringify(Object.keys(engine.unsupported ?? {}).sort());
    if (ru !== eu) problems.push(`unsupported: ref ${ru} engine ${eu}`);
    row.results[config.name] = problems;
    if (problems.length) failed++;
  }
  rows.push(row);
}

const width = Math.max(...rows.map((r) => r.name.length));
for (const row of rows) {
  const cells = configs.map((c) => {
    const p = row.results[c.name];
    return `${c.name} ${p.length ? `FAIL (${p.length})` : 'pass'}`.padEnd(16);
  });
  console.log(`${row.name.padEnd(width)}  ${cells.join('')}`);
  for (const c of configs) {
    const p = row.results[c.name];
    if (p.length && (verbose || filter)) for (const line of p) console.log(`    [${c.name}] ${line}`);
    else if (p.length) for (const line of p.slice(0, 3)) console.log(`    [${c.name}] ${line}`);
  }
}
const total = rows.length * configs.length;
console.log(`\n${total - failed}/${total} passed (tolerance ${tolerance} px)`);
process.exit(failed ? 1 : 0);
