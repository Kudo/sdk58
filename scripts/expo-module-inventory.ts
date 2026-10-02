#!/usr/bin/env bun
/** Source inventory only; discovery does not imply a supported native API. */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {URL, fileURLToPath, pathToFileURL} from 'node:url';
import ts from 'typescript';
import {scanNativeFactories} from './expo-view-inventory.ts';

const FACTORIES = new Set(['requireNativeModule', 'requireOptionalNativeModule']);
const OUTPUT = fileURLToPath(new URL('../docs/expo-native-modules.json', import.meta.url));
type ModuleCall = {
  file: string; line: number; factory: string; module: string | null;
  optional: boolean; platforms: string[]; members: string[]; expression?: string;
};

export function scanNativeModules(file: string, source: string): ModuleCall[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // Deliberately conservative: statically named members of the local binding.
  // Imported/re-exported bindings and dynamic property names are not inferred.
  const bindings = new Map<number, string>();
  const members = new Map<string, Set<string>>();
  function collect(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      bindings.set(node.initializer.getStart(), node.name.text);
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ts.isIdentifier(node.expression)) {
      const name = ts.isPropertyAccessExpression(node) ? node.name.text
        : node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined;
      if (name) {
        const set = members.get(node.expression.text) ?? new Set<string>();
        set.add(name); members.set(node.expression.text, set);
      }
    }
    ts.forEachChild(node, collect);
  }
  collect(ast);
  return scanNativeFactories(file, source, FACTORIES).map(({view: _, position, ...call}) => ({
    ...call, optional: call.factory === 'requireOptionalNativeModule',
    members: [...(members.get(bindings.get(position) ?? '') ?? [])].sort(),
  }));
}

export function mergeNativeModules(calls: (ModuleCall & {package: string})[]) {
  const groups = new Map<string, {package: string; module: string | null; platforms: string[]; members: string[]; callSites: ModuleCall[]}>();
  for (const {package: pkg, ...call} of calls) {
    const key = JSON.stringify([pkg, call.module, call.expression ? [call.file, call.line] : null]);
    const group = groups.get(key) ?? {package: pkg, module: call.module, platforms: [], members: [], callSites: []};
    group.platforms = [...new Set([...group.platforms, ...call.platforms])].sort();
    group.members = [...new Set([...group.members, ...call.members])].sort();
    group.callSites.push(call);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => `${a.package}/${a.module}`.localeCompare(`${b.package}/${b.module}`, 'en'));
}

function main() {
  const arg = (name: string, fallback?: string) => {
    const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1];
  };
  const repo = arg('--expo-root');
  if (!repo) throw new Error('Usage: bun scripts/expo-module-inventory.ts --expo-root <checkout> [--ref <commit>] [--check]');
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024}).trimEnd();
  const commit = git('rev-parse', arg('--ref', 'origin/sdk-58')!);
  const files = git('ls-tree', '-r', '--name-only', commit, '--', 'packages').split('\n');
  const manifests = new Set(files.filter(f => f.endsWith('/package.json')));
  const names = new Map<string, string>();
  const calls: (ModuleCall & {package: string})[] = [];
  const candidates = git('grep', '-l', '-E', 'requireNativeModule|requireOptionalNativeModule', commit, '--', 'packages').split('\n').map(f => f.slice(commit.length + 1));
  for (const file of candidates) {
    if (!/\.[cm]?[jt]sx?$/.test(file) || /\/(build|__tests__|tests|__mocks__|mocks|__fixtures__|fixtures|node_modules)\//.test(file) || /\.(test|spec)\./.test(file)) continue;
    let dir = path.posix.dirname(file);
    while (!manifests.has(`${dir}/package.json`) && dir !== '.') dir = path.posix.dirname(dir);
    if (dir === '.') continue;
    let pkg = names.get(dir);
    if (!pkg) {pkg = JSON.parse(git('show', `${commit}:${dir}/package.json`)).name; names.set(dir, pkg!);}
    calls.push(...scanNativeModules(file, git('show', `${commit}:${file}`)).map(call => ({...call, package: pkg!})));
  }
  const inventory = {repository: 'https://github.com/expo/expo', ref: 'sdk-58', commit,
    note: 'Required/optional native module call sites, not a claim of support. Members are same-file static property accesses only; empty does not mean no APIs. Dynamic names are retained. Platforms are inferred from file paths.',
    modules: mergeNativeModules(calls)};
  const output = JSON.stringify(inventory, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(OUTPUT, 'utf8') !== output) throw new Error('Expo module inventory is stale; regenerate using the pinned commit.');
  } else fs.writeFileSync(OUTPUT, output);
  console.log(`${inventory.modules.length} entries, ${calls.length} call sites, ${new Set(calls.map(c => c.package)).size} packages (${commit})`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
