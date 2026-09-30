import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  compactNode,
  formatRender,
  formatRun,
  parseSelector,
  queryTree,
  textLine,
} from '../src/format.ts';
import type {RunResult, ShadowNodeJSON, TreeNode} from '../src/schema.ts';
import {convertShadowTree} from '../src/tree.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');
const shadow = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'shadow-tree.json'), 'utf8')) as ShadowNodeJSON;
const tree = convertShadowTree(shadow);
const render = {viewport: {width: 390, height: 844}, source: 'shadowTree' as const, root: tree};

test('selectors: =, ~ (case-insensitive), unknown field', () => {
  const submit = queryTree(tree, {select: ['testID=submit']});
  assert.equal(submit.length, 1);
  assert.equal(submit[0].role, 'button');
  assert.deepEqual(queryTree(tree, {select: ['role=button']}).map(n => n.testID), ['submit']);
  assert.deepEqual(queryTree(tree, {select: ['name~SIGN']}).map(n => n.type), ['Paragraph']);
  assert.equal(queryTree(tree, {select: ['type=Paragraph', 'name~submit']}).length, 1);
  assert.throws(() => parseSelector('color=red'), /invalid selector/);
});

test('subtree and depth', () => {
  const [sub] = queryTree(tree, {subtree: 'testID=submit'});
  assert.equal(sub.testID, 'submit');
  assert.equal(sub.children.length, 1);
  const [shallow] = queryTree(tree, {depth: 1});
  assert.equal(shallow.children.length, 1);
  assert.equal(shallow.children[0].children.length, 0);
  assert.throws(() => queryTree(tree, {subtree: 'testID=nope'}), /no node matches/);
});

test('compact drops defaults, empties, style and a11y.raw', () => {
  const [submit] = queryTree(tree, {select: ['testID=submit'], depth: 0});
  const c = compactNode(submit);
  assert.equal('style' in c, false);
  assert.equal('children' in c, false);
  assert.equal('text' in c, false);
  assert.equal((c.a11y as Record<string, unknown>).raw, undefined);
  assert.equal(c.role, 'button');
  const withStyle = compactNode(submit, true);
  assert.ok(withStyle.style);
  assert.equal((withStyle.style as Record<string, unknown>).layoutDirection, undefined);
});

test('text line: key, type, testID, role, name, box, flags', () => {
  const [toggle] = queryTree(tree, {select: ['type=AndroidSwitch']});
  assert.match(textLine(toggle), /^remember AndroidSwitch #remember role=switch "Remember me" \{24,\d+(\.\d)?,51x31\} \[disabled, checked\]$/);
  const text = formatRender(render, {format: 'text'});
  assert.equal(text.split('\n')[0], 'RootView RootView {0,0,390x844}');
  assert.match(text, /^ {4}submit View #submit role=button "Submit"/m);
  assert.match(text, /^ {6}submit\/Paragraph:1 Paragraph role=text "Submit"/m);
});

test('formats of a render result', () => {
  const json = JSON.parse(formatRender(render, {format: 'json'}));
  assert.equal(json.root.ref, 'n0');
  const matches = JSON.parse(formatRender(render, {format: 'json', select: ['role=button']}));
  assert.equal(matches.matches.length, 1);
  const compact = JSON.parse(formatRender(render, {format: 'compact'}));
  assert.equal(compact.root.type, 'RootView');
  assert.ok(formatRender(render, {format: 'compact'}).length < formatRender(render, {format: 'json'}).length / 2);
  const lines = formatRender(render, {format: 'ndjson'}).trim().split('\n').map(l => JSON.parse(l));
  assert.equal(lines[0].depth, 0);
  assert.equal(lines[0].parent, null);
  assert.equal(lines[1].parent, 'RootView');
  assert.equal(lines[1].key, 'RootView/View:1');
});

test('formats of a run result', () => {
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
  assert.match(text, /^step 0 tap #submit hit=Paragraph \[touchStart, touchEnd\]$/m);
  assert.match(text, /^step 1 tap \[\] ERROR Target not found$/m);
  assert.match(text, /^snapshot after:\nsubmit View #submit/m);
  const nd = formatRun(run, {format: 'ndjson', select: ['testID=submit'], depth: 0}).trim().split('\n').map(l => JSON.parse(l));
  assert.equal(nd[0].step.action, 'tap');
  assert.deepEqual(nd.filter(l => l.tree).map(l => l.tree), ['after', 'final']);
});

test('CLI: --format text --select (fake host)', {timeout: 120_000}, () => {
  const proc = spawnSync(
    process.execPath,
    [path.join(ROOT, 'bin', 'rn-a11y-tree.js'), 'render', path.join(ROOT, 'examples', 'basic', 'App.tsx'), '--platform', 'android', '--format', 'text', '--select', 'role=button'],
    {cwd: ROOT, encoding: 'utf8', env: {...process.env, RN_A11Y_HOST_BIN: path.join(FIXTURES, 'fake-host.js'), FAKE_HOST_MODE: 'shadow-tree'}},
  );
  assert.equal(proc.status, 0, proc.stderr);
  assert.match(proc.stdout.trim(), /^submit View #submit role=button "Submit" \{24,154,342x48\}$/);
  const bad = spawnSync(
    process.execPath,
    [path.join(ROOT, 'bin', 'rn-a11y-tree.js'), 'render', path.join(ROOT, 'examples', 'basic', 'App.tsx'), '--platform', 'android', '--format', 'xml'],
    {cwd: ROOT, encoding: 'utf8', env: {...process.env, RN_A11Y_HOST_BIN: path.join(FIXTURES, 'fake-host.js')}},
  );
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--format must be one of: json, compact, text, ndjson/);
});
