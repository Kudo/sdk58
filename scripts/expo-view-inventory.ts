#!/usr/bin/env bun
/** Scan a pinned Expo checkout without checking out or modifying that repository. */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'docs/expo-native-views.json');
const FACTORIES = new Set(['requireNativeView', 'requireNativeViewManager', 'requireNativeComponent', 'codegenNativeComponent']);
type Call = {
  file: string; line: number; factory: string; module: string | null;
  view: string | null; platforms: string[]; expression?: string;
};
type PackageCall = Call & {package: string};

function platforms(file: string): string[] {
  if (/\.ios\.|\/swift-ui\//.test(file)) return ['ios'];
  if (/\.android\.|\/jetpack-compose\//.test(file)) return ['android'];
  if (/\.web\./.test(file)) return ['web'];
  return ['android', 'ios'];
}

export function scanNativeViews(file: string, source: string): Call[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = new Map<string, string>();
  const namespaces = new Set<string>();
  const constants = new Map<string, ts.Expression>();
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const from = statement.moduleSpecifier.text;
      if (!/^(expo|expo-modules-core|react-native)(\/|$)/.test(from)) continue;
      const clause = statement.importClause;
      if (clause?.name && from.endsWith('/codegenNativeComponent')) imports.set(clause.name.text, 'codegenNativeComponent');
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
        const name = (binding.propertyName ?? binding.name).text;
        if (FACTORIES.has(name)) imports.set(binding.name.text, name);
      }
    }
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) constants.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  function values(node: ts.Expression | undefined, env = new Map<string, ts.Expression>(), seen = new Set<string>()): string[] {
    if (!node) return [];
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isConditionalExpression(node)) return [...new Set([...values(node.whenTrue, env, new Set(seen)), ...values(node.whenFalse, env, new Set(seen))])];
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      seen.add(node.text);
      return values(env.get(node.text) ?? constants.get(node.text), env, seen);
    }
    return [];
  }
  const allCalls: ts.CallExpression[] = [];
  function collect(node: ts.Node) {
    if (ts.isCallExpression(node)) allCalls.push(node);
    ts.forEachChild(node, collect);
  }
  collect(ast);
  const calls: Call[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      const factory = ts.isIdentifier(expr) ? imports.get(expr.text)
        : ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && namespaces.has(expr.expression.text) && FACTORIES.has(expr.name.text)
          ? expr.name.text : undefined;
      if (factory) {
        let environments = [new Map<string, ts.Expression>()];
        // Expo UI uses small local factories such as createButtonComponent(name).
        // Expand their static invocations; retain an unresolved entry otherwise.
        let ancestor: ts.Node | undefined = node.parent;
        while (ancestor && !ts.isFunctionDeclaration(ancestor)) ancestor = ancestor.parent;
        if (ancestor && ts.isFunctionDeclaration(ancestor) && ancestor.name) {
          const fn = ancestor;
          const invocations = allCalls.filter(call => ts.isIdentifier(call.expression) && call.expression.text === fn.name!.text);
          if (invocations.length) environments = invocations.map(call => {
            const env = new Map<string, ts.Expression>();
            fn.parameters.forEach((parameter, index) => {
              if (ts.isIdentifier(parameter.name) && call.arguments[index]) env.set(parameter.name.text, call.arguments[index]);
            });
            return env;
          });
        }
        for (const env of environments) {
          const modules = values(node.arguments[0], env);
          const names = factory.startsWith('requireNativeView') ? values(node.arguments[1], env) : [];
          for (const module of modules.length ? modules : [null]) for (const view of names.length ? names : [null]) {
            const dynamic = module == null || (factory.startsWith('requireNativeView') && node.arguments.length > 1 && view == null);
            calls.push({file, line: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1,
              factory, module, view, platforms: platforms(file), ...(dynamic ? {expression: node.getText(ast)} : {})});
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return calls;
}

export function mergeNativeViews(calls: PackageCall[]) {
  const groups = new Map<string, {package: string; module: string | null; view: string | null; platforms: string[]; callSites: Call[]}>();
  for (const {package: pkg, ...call} of calls) {
    const key = JSON.stringify([pkg, call.module, call.view, call.expression ? [call.file, call.line] : null]);
    let group = groups.get(key);
    if (!group) {
      group = {package: pkg, module: call.module, view: call.view, platforms: [], callSites: []};
      groups.set(key, group);
    }
    group.platforms = [...new Set([...group.platforms, ...call.platforms])].sort();
    group.callSites.push(call);
  }
  return [...groups.values()].sort((a, b) => `${a.package}/${a.module}/${a.view}`.localeCompare(`${b.package}/${b.module}/${b.view}`, 'en'));
}

function main() {
  const arg = (name: string, fallback?: string) => {
    const i = process.argv.indexOf(name);
    return i < 0 ? fallback : process.argv[i + 1];
  };
  const repo = arg('--expo-root');
  if (!repo) throw new Error('Usage: bun scripts/expo-view-inventory.ts --expo-root <expo checkout> [--ref <SDK commit>] [--check]');
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024}).trimEnd();
  const commit = git('rev-parse', arg('--ref', 'origin/sdk-58')!);
  const files = git('ls-tree', '-r', '--name-only', commit, '--', 'packages').split('\n');
  const manifests = new Set(files.filter(f => f.endsWith('/package.json')));
  const packageNames = new Map<string, string>();
  const calls: PackageCall[] = [];
  // git grep narrows the scan; TypeScript's AST handles aliases and multiline calls.
  const candidates = git('grep', '-l', '-E', 'requireNativeView|requireNativeComponent|codegenNativeComponent', commit, '--', 'packages').split('\n').map(f => f.slice(commit.length + 1));
  const excludedPackages = new Set(['expo', 'expo-modules-core', 'expo-modules-test-core', 'expo-type-information', 'jest-expo']);
  for (const file of candidates) {
    if (!/\.[cm]?[jt]sx?$/.test(file) || /\/(build|__tests__|tests|__mocks__|mocks|__fixtures__|fixtures|node_modules)\//.test(file) || /\.(test|spec)\./.test(file)) continue;
    let dir = path.posix.dirname(file);
    while (!manifests.has(`${dir}/package.json`) && dir !== '.') dir = path.posix.dirname(dir);
    if (dir === '.') continue;
    let pkg = packageNames.get(dir);
    if (!pkg) {
      pkg = JSON.parse(git('show', `${commit}:${dir}/package.json`)).name as string;
      packageNames.set(dir, pkg);
    }
    if (excludedPackages.has(pkg)) continue;
    calls.push(...scanNativeViews(file, git('show', `${commit}:${file}`)).map(call => ({...call, package: pkg!})));
  }
  const inventory = {repository: 'https://github.com/expo/expo', ref: 'sdk-58', commit,
    note: 'Native-view call sites, not a claim of support. Platforms are inferred from source paths; see expo-support.md for tested behavior.',
    views: mergeNativeViews(calls)};
  const text = JSON.stringify(inventory, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(OUTPUT, 'utf8') !== text) throw new Error('Expo inventory is stale; regenerate using the pinned commit.');
  } else fs.writeFileSync(OUTPUT, text);
  console.log(`${inventory.views.length} inventory entries, ${new Set(calls.map(c => `${c.file}:${c.line}`)).size} call sites, ${new Set(calls.map(c => c.package)).size} packages (${commit})`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
