import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';

import {
  compactNode,
  formatRender,
  formatRun,
  parseSelector,
  queryTree,
  textLine,
} from '../packages/react-native-a11y-tree/src/format.ts';
import type {RunResult, ShadowNodeJSON, TreeNode} from '../packages/react-native-a11y-tree/src/schema.ts';
import {convertShadowTree} from '../packages/react-native-a11y-tree/src/tree.ts';
import {diffTrees} from '../packages/react-native-a11y-tree/src/diff.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');
const shadow = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'shadow-tree.json'), 'utf8')) as ShadowNodeJSON;
const tree = convertShadowTree(shadow);
const render = {viewport: {width: 390, height: 844}, source: 'shadowTree' as const, root: tree};

describe('format', () => {
  it('selectors: =, ~ (case-insensitive), unknown field', () => {
    const submit = queryTree(tree, {select: ['testID=submit']});
    expect(submit.length).toBe(1);
    expect(submit[0].role).toBe('button');
    expect(queryTree(tree, {select: ['role=button']}).map(n => n.testID)).toStrictEqual(['submit']);
    expect(queryTree(tree, {select: ['name~SIGN']}).map(n => n.type)).toStrictEqual(['Paragraph']);
    expect(queryTree(tree, {select: ['type=Paragraph', 'name~submit']}).length).toBe(1);
    expect(() => parseSelector('color=red')).toThrow(/invalid selector/);
  });

  it('subtree and depth', () => {
    const [sub] = queryTree(tree, {subtree: 'testID=submit'});
    expect(sub.testID).toBe('submit');
    expect(sub.children.length).toBe(1);
    const [shallow] = queryTree(tree, {depth: 1});
    expect(shallow.children.length).toBe(1);
    expect(shallow.children[0].children.length).toBe(0);
    expect(() => queryTree(tree, {subtree: 'testID=nope'})).toThrow(/no node matches/);
  });

  it('compact drops defaults, empties, style and a11y.raw', () => {
    const [submit] = queryTree(tree, {select: ['testID=submit'], depth: 0});
    const c = compactNode(submit);
    expect('style' in c).toBe(false);
    expect('children' in c).toBe(false);
    expect('text' in c).toBe(false);
    expect((c.a11y as Record<string, unknown>).raw).toBe(undefined);
    expect(c.role).toBe('button');
    const withStyle = compactNode(submit, true);
    expect(withStyle.style).toBeTruthy();
    expect((withStyle.style as Record<string, unknown>).layoutDirection).toBe(undefined);
  });

  it('text line uses one short selector and keeps interaction state', () => {
    const [toggle] = queryTree(tree, {select: ['type=AndroidSwitch']});
    expect(textLine(toggle)).toMatch(/^#remember switch "Remember me" \{24,\d+,51x31\} \[disabled, checked\]$/);
    const text = formatRender(render, {format: 'text'});
    expect(text).toMatch(/#submit button "Submit" \{24,154,342x48\}/);
    expect(text).not.toContain('submit/Paragraph:1');
    expect(text).not.toMatch(/\bsubmit View #submit/);
  });

  it('text hides diagnostics and preserves JSON diagnostics', () => {
    const withDiagnostics = {...render, diagnostics: [{code: 'DEPENDENCY_COMPATIBILITY' as const, target: 'react-native', message: 'old version'}]};
    expect(formatRender(withDiagnostics, {format: 'text'})).toContain('diagnostics: 1');
    expect(formatRender(withDiagnostics, {format: 'text'})).not.toContain('old version');
    expect(JSON.parse(formatRender(withDiagnostics, {format: 'json'})).diagnostics[0].message).toBe('old version');
  });

  it('text shows the top stack screen by default, with an all-screens escape hatch', () => {
    const frame = {x: 0, y: 0, width: 390, height: 844};
    const stacked = convertShadowTree({type: 'RootView', frame, children: [
      {type: 'RNSScreenStack', frame, children: [
        {type: 'RNSScreen', frame, children: [{type: 'View', testID: 'old', frame, children: []}]},
        {type: 'RNSScreen', frame, children: [{type: 'View', testID: 'top', frame, children: []}]},
      ]},
    ]});
    const result = {...render, root: stacked};
    expect(formatRender(result, {format: 'text'})).toContain('#top');
    expect(formatRender(result, {format: 'text'})).not.toContain('#old');
    expect(formatRender(result, {format: 'text', allScreens: true})).toContain('#old');
    expect(formatRender(result, {format: 'json'})).toContain('"old"');
  });

  it('formats of a render result', () => {
    const json = JSON.parse(formatRender(render, {format: 'json'}));
    expect(json.root.ref).toBe('n0');
    const matches = JSON.parse(formatRender(render, {format: 'json', select: ['role=button']}));
    expect(matches.matches.length).toBe(1);
    const compact = JSON.parse(formatRender(render, {format: 'compact'}));
    expect(compact.root.type).toBe('RootView');
    expect(formatRender(render, {format: 'compact'}).length < formatRender(render, {format: 'json'}).length / 2).toBeTruthy();
    const lines = formatRender(render, {format: 'ndjson'}).trim().split('\n').map(l => JSON.parse(l));
    expect(lines[0].depth).toBe(0);
    expect(lines[0].parent).toBe(null);
    expect(lines[1].parent).toBe('RootView');
    expect(lines[1].key).toBe('RootView/View:1');
  });

  it('formats of a run result', () => {
    const run: RunResult = {
      viewport: render.viewport,
      source: 'shadowTree',
      steps: [
        {index: 0, action: 'tap', target: {tag: 5, ref: 'n6', testID: 'submit', type: 'View', box: null}, hit: {tag: 6, ref: 'n7', testID: null, type: 'Paragraph', box: null}, events: ['touchStart', 'touchEnd']},
        {index: 1, action: 'tap', target: null, hit: null, events: [], error: 'Target not found'},
      ],
      snapshots: {after: tree},
      final: tree,
      fallbacks: [],
      capabilities: [],
    };
    const text = formatRun(run, {format: 'text', select: ['testID=submit'], depth: 0});
    expect(text).toMatch(/^step 0 tap #submit hit=Paragraph \[touchStart, touchEnd\]$/m);
    expect(text).toMatch(/^step 1 tap \[\] ERROR Target not found$/m);
    expect(text).toMatch(/^snapshot after:\n#submit button/m);
    expect(text).not.toContain('final:');
    const nd = formatRun(run, {format: 'ndjson', select: ['testID=submit'], depth: 0}).trim().split('\n').map(l => JSON.parse(l));
    expect(nd[0].step.action).toBe('tap');
    expect(nd.filter(l => l.tree).map(l => l.tree)).toStrictEqual(['after', 'final']);
  });

  it('summarizes final changes when a run has no snapshots', () => {
    const after = structuredClone(tree);
    after.children[0].children.find(n => n.testID === 'submit')!.name = 'Saved';
    const result: RunResult = {viewport: render.viewport, source: 'shadowTree', steps: [], snapshots: {}, final: after, finalDiff: diffTrees(tree, after), fallbacks: [], capabilities: []};
    const text = formatRun(result, {format: 'text'});
    expect(text).toContain('final changes:');
    expect(text).toContain('Saved');
    expect(text).not.toContain('final:\n');
  });

  it('medium render matches the compact golden and stays at least 60% below v0.1.4', () => {
    const medium = JSON.parse(gunzipSync(fs.readFileSync(path.join(FIXTURES, 'medium-text-tree.json.gz'))).toString('utf8'));
    const output = formatRender(medium, {format: 'text'});
    expect(output).toBe(fs.readFileSync(path.join(FIXTURES, 'medium-text.golden'), 'utf8'));
    // 79,422 bytes is a lower bound for v0.1.4: old line grammar and two-space indentation.
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(31_768);
  });

  it('medium run matches its compact golden', () => {
    const medium = JSON.parse(gunzipSync(fs.readFileSync(path.join(FIXTURES, 'medium-run-text.json.gz'))).toString('utf8')) as RunResult;
    const output = formatRun(medium, {format: 'text'});
    expect(output).toBe(fs.readFileSync(path.join(FIXTURES, 'medium-run-text.golden'), 'utf8'));
    expect(output).not.toContain('final:\n');
  });

  it('CLI: --format text --select (fake host)', {timeout: 120_000}, () => {
    const proc = spawnSync(
      'node',
      [path.join(ROOT, 'packages/react-native-a11y-tree', 'src', 'cli.ts'), 'render', path.join(ROOT, 'examples', 'basic', 'App.tsx'), '--platform', 'android', '--format', 'text', '--select', 'role=button'],
      {cwd: ROOT, encoding: 'utf8', env: {...process.env, RN_A11Y_HOST_BIN: path.join(FIXTURES, 'fake-host.ts'), RN_A11Y_HOST_RUNNER: 'bun', FAKE_HOST_MODE: 'shadow-tree'}},
    );
    expect(proc.status, proc.stderr).toBe(0);
    expect(proc.stdout.trim()).toMatch(/^#submit button "Submit" \{24,154,342x48\}$/);
    const bad = spawnSync(
      'node',
      [path.join(ROOT, 'packages/react-native-a11y-tree', 'src', 'cli.ts'), 'render', path.join(ROOT, 'examples', 'basic', 'App.tsx'), '--platform', 'android', '--format', 'xml'],
      {cwd: ROOT, encoding: 'utf8', env: {...process.env, RN_A11Y_HOST_BIN: path.join(FIXTURES, 'fake-host.ts'), RN_A11Y_HOST_RUNNER: 'bun'}},
    );
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/--format must be one of: json, compact, text, ndjson/);
  });

  it('CLI defaults to text when stdout is piped', {timeout: 120_000}, () => {
    const proc = spawnSync('node', [path.join(ROOT, 'packages/react-native-a11y-tree/src/cli.ts'), 'render', path.join(ROOT, 'examples/basic/App.tsx'), '--platform', 'android', '--select', 'testID=submit'], {
      cwd: ROOT, encoding: 'utf8', env: {...process.env, RN_A11Y_HOST_BIN: path.join(FIXTURES, 'fake-host.ts'), RN_A11Y_HOST_RUNNER: 'bun', FAKE_HOST_MODE: 'shadow-tree'},
    });
    expect(proc.status, proc.stderr).toBe(0);
    expect(proc.stdout).toMatch(/^#submit button "Submit"/);
  });
});
