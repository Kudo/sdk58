import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
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

  it('text line: key, type, testID, role, name, box, flags', () => {
    const [toggle] = queryTree(tree, {select: ['type=AndroidSwitch']});
    expect(textLine(toggle)).toMatch(/^remember AndroidSwitch #remember role=switch "Remember me" \{24,\d+(\.\d)?,51x31\} \[disabled, checked\]$/);
    const text = formatRender(render, {format: 'text'});
    expect(text.split('\n')[0]).toBe('RootView RootView {0,0,390x844}');
    expect(text).toMatch(/^ {4}submit View #submit role=button "Submit"/m);
    expect(text).toMatch(/^ {6}submit\/Paragraph:1 Paragraph role=text "Submit"/m);
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
    expect(text).toMatch(/^snapshot after:\nsubmit View #submit/m);
    const nd = formatRun(run, {format: 'ndjson', select: ['testID=submit'], depth: 0}).trim().split('\n').map(l => JSON.parse(l));
    expect(nd[0].step.action).toBe('tap');
    expect(nd.filter(l => l.tree).map(l => l.tree)).toStrictEqual(['after', 'final']);
  });

  it('CLI: --format text --select (fake host)', {timeout: 120_000}, () => {
    const proc = spawnSync(
      'node',
      [path.join(ROOT, 'src', 'cli.ts'), 'render', path.join(ROOT, 'examples', 'basic', 'App.tsx'), '--platform', 'android', '--format', 'text', '--select', 'role=button'],
      {cwd: ROOT, encoding: 'utf8', env: {...process.env, RN_A11Y_HOST_BIN: path.join(FIXTURES, 'fake-host.ts'), RN_A11Y_HOST_RUNNER: 'bun', FAKE_HOST_MODE: 'shadow-tree'}},
    );
    expect(proc.status, proc.stderr).toBe(0);
    expect(proc.stdout.trim()).toMatch(/^submit View #submit role=button "Submit" \{24,154,342x48\}$/);
    const bad = spawnSync(
      'node',
      [path.join(ROOT, 'src', 'cli.ts'), 'render', path.join(ROOT, 'examples', 'basic', 'App.tsx'), '--platform', 'android', '--format', 'xml'],
      {cwd: ROOT, encoding: 'utf8', env: {...process.env, RN_A11Y_HOST_BIN: path.join(FIXTURES, 'fake-host.ts'), RN_A11Y_HOST_RUNNER: 'bun'}},
    );
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/--format must be one of: json, compact, text, ndjson/);
  });
});
