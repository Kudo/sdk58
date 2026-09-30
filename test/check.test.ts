import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  addStepViolations,
  type CheckResult,
  checkText,
  checkTree,
  composite,
  contrastRatio,
  parseColor,
  readRulesFile,
  validateRules,
} from '../src/check.ts';
import type {TreeNode} from '../src/schema.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'cli.ts');
const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');
const FAKE_HOST = path.join(ROOT, 'test', 'fixtures', 'fake-host.ts');
const VIEWPORT = {viewport: {width: 390, height: 844}, source: 'shadowTree'};

let refs = 0;
function node(partial: Partial<TreeNode> & {key: string}): TreeNode {
  return {
    ref: `n${refs++}`,
    type: 'View',
    sel: partial.key,
    role: null,
    name: null,
    a11y: {},
    box: {x: 0, y: 0, width: 100, height: 100},
    style: {},
    text: null,
    testID: null,
    children: [],
    ...partial,
  };
}

function text(key: string, value: string, style: Record<string, unknown>): TreeNode {
  return node({key, type: 'Paragraph', role: 'text', name: value, text: value, style});
}

test('parseColor, composite and contrastRatio', () => {
  assert.deepEqual(parseColor('#1e6fff'), {r: 30, g: 111, b: 255, a: 1});
  assert.deepEqual(parseColor('#fff'), {r: 255, g: 255, b: 255, a: 1});
  assert.deepEqual(parseColor('#00000080'), {r: 0, g: 0, b: 0, a: 128 / 255});
  assert.deepEqual(parseColor('rgba(30, 111, 255, 0.5)'), {r: 30, g: 111, b: 255, a: 0.5});
  assert.deepEqual(parseColor('white'), {r: 255, g: 255, b: 255, a: 1});
  assert.equal(parseColor('hsl(0, 0%, 0%)'), null);
  assert.equal(parseColor(42), null);
  const white = parseColor('#fff')!;
  const black = parseColor('#000')!;
  assert.equal(contrastRatio(black, white), 21);
  assert.equal(Math.round(contrastRatio(white, parseColor('#1e6fff')!) * 100) / 100, 4.4);
  const half = composite({...black, a: 0.5}, white);
  assert.deepEqual([Math.round(half.r), half.a], [128, 1]);
});

test('validateRules and readRulesFile reject bad rules', () => {
  assert.deepEqual(validateRules({names: true, touchTarget: {min: 44}}, 'x'), {names: true, touchTarget: {min: 44}});
  assert.throws(() => validateRules({colours: true}, 'x'), /unknown rule "colours"/);
  assert.throws(() => validateRules({touchTarget: {size: 4}}, 'x'), /unknown option "size"/);
  assert.throws(() => validateRules({contrast: {min: -1}}, 'x'), /"contrast.min" must be a number > 0/);
  assert.throws(() => validateRules({names: {ignore: ['bogus']}}, 'x'), /invalid selector/);
  assert.throws(() => validateRules({tokens: true}, 'x'), /"tokens" must be an object/);
  assert.throws(() => validateRules({tokens: {colors: ['#12']}}, 'x'), /cannot parse color "#12"/);
  assert.throws(() => validateRules({tokens: {spacing: 0}}, 'x'), /tokens.spacing/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-rules-'));
  const file = path.join(dir, 'rules.json');
  fs.writeFileSync(file, JSON.stringify({names: true}));
  assert.throws(() => readRulesFile(file), /expected \{"rules": \{\.\.\.\}\}/);
  fs.writeFileSync(file, '{');
  assert.throws(() => readRulesFile(file), /not valid JSON/);
  fs.writeFileSync(file, JSON.stringify({$schema: 'x', rules: {names: true}}));
  assert.deepEqual(readRulesFile(file), {names: true});
  fs.rmSync(dir, {recursive: true, force: true});
});

test('names: focusable nodes and images; grouped children are skipped; placeholder counts for textbox', () => {
  const root = node({
    key: 'root',
    children: [
      node({key: 'ok', role: 'button', name: 'Save'}),
      node({key: 'unnamed', role: 'button', children: [node({key: 'icon', role: 'image'})]}),
      node({key: 'group', a11y: {accessible: true}, name: 'Card', children: [node({key: 'inner', role: 'button'})]}),
      node({key: 'field', role: 'textbox', style: {placeholder: 'Email'}}),
      node({key: 'logo', role: 'image'}),
    ],
  });
  const result = checkTree(root, {names: true}, VIEWPORT);
  assert.deepEqual(
    result.violations.map(v => [v.rule, v.key, v.prop]),
    [
      ['names', 'unnamed', 'name'],
      ['names', 'icon', 'name'],
      ['names', 'logo', 'name'],
    ],
  );
  const field = result.nodes.find(n => n.key === 'field')!;
  assert.deepEqual(field.props.name, {rule: 'names', got: 'Email', want: 'non-empty', pass: true, from: 'placeholder'});
  assert.equal(result.nodes.find(n => n.key === 'inner'), undefined);
  assert.equal(result.ok, false);
  assert.deepEqual(result.summary, {nodes: 8, checked: 6, violations: 3, byRule: {names: 3}});
});

test('touchTarget: width and height of interactive nodes, with min and ignore', () => {
  const root = node({
    key: 'root',
    children: [
      node({key: 'small', role: 'button', name: 'x', box: {x: 0, y: 0, width: 60, height: 30}}),
      node({key: 'switch', role: 'switch', name: 's', testID: 'switch', box: {x: 0, y: 0, width: 51, height: 31}}),
      node({key: 'plain', box: {x: 0, y: 0, width: 1, height: 1}}),
    ],
  });
  const result = checkTree(root, {touchTarget: {min: 44, ignore: ['testID=switch']}}, VIEWPORT);
  assert.deepEqual(result.nodes.map(n => n.key), ['small']);
  assert.deepEqual(result.nodes[0].props.height, {rule: 'touchTarget', got: 30, want: 44, op: '>=', pass: false});
  assert.equal(result.nodes[0].props.width.pass, true);
  assert.deepEqual(result.violations[0], {
    rule: 'touchTarget',
    key: 'small',
    sel: 'small',
    prop: 'height',
    expected: '>= 44',
    actual: 30,
    message: 'touch target height 30 < 44',
  });
  // Default min 48: the switch height (31) fails too.
  assert.deepEqual(
    checkTree(root, {touchTarget: true}, VIEWPORT).violations.map(v => [v.key, v.prop]),
    [
      ['small', 'height'],
      ['switch', 'height'],
    ],
  );
});

test('hiddenFocusable: hidden subtrees; importantForAccessibility "no" hides only the node', () => {
  const root = node({
    key: 'root',
    children: [
      node({
        key: 'hidden',
        a11y: {hidden: true, raw: {importantForAccessibility: 'no-hide-descendants'}},
        children: [node({key: 'trapped', role: 'button', name: 'Buy'})],
      }),
      node({
        key: 'no',
        a11y: {hidden: true, raw: {importantForAccessibility: 'no'}},
        children: [node({key: 'visible', role: 'button', name: 'Ok'})],
      }),
      node({key: 'self', role: 'link', name: 'L', a11y: {hidden: true}}),
    ],
  });
  const result = checkTree(root, {hiddenFocusable: true, names: true}, VIEWPORT);
  assert.deepEqual(
    result.violations.map(v => [v.rule, v.key]),
    [
      ['hiddenFocusable', 'trapped'],
      ['hiddenFocusable', 'self'],
    ],
  );
  // Hidden nodes are not checked for names.
  assert.equal(result.nodes.find(n => n.key === 'trapped')!.props.name, undefined);
  assert.equal(result.nodes.find(n => n.key === 'visible')!.props.name.pass, true);
});

test('contrast: host effectiveBackground, else ancestors composited; large text threshold', () => {
  const root = node({
    key: 'root',
    style: {backgroundColor: 'rgba(0, 0, 0, 1)'},
    children: [
      node({
        key: 'card',
        style: {backgroundColor: 'rgba(255, 255, 255, 0.5)'},
        children: [
          text('grey', 'Hello', {color: 'rgba(128, 128, 128, 1)', fontSize: 14}),
          text('big', 'Title', {color: 'rgba(118, 118, 118, 1)', fontSize: 24, effectiveBackground: 'rgba(255, 255, 255, 1)'}),
        ],
      }),
    ],
  });
  const result = checkTree(root, {contrast: {min: 4.5, minLarge: 3}}, VIEWPORT);
  const grey = result.nodes.find(n => n.key === 'grey')!.props.contrast;
  assert.equal(grey.bgFrom, 'ancestors');
  assert.equal(grey.bg, '#808080'); // 50% white over black
  assert.equal(grey.got, 1.01); // grey 128 on 127.5 (50% white over black)
  assert.equal(grey.pass, false);
  const big = result.nodes.find(n => n.key === 'big')!.props.contrast;
  assert.deepEqual(
    [big.bgFrom, big.bg, big.got, big.want, big.pass, big.large],
    ['host', '#ffffff', 4.54, 3, true, true],
  );
  // Semi-transparent text is composited over the background first.
  const faded = checkTree(
    node({key: 'r', children: [text('t', 'x', {color: 'rgba(0, 0, 0, 0.1)'})]}),
    {contrast: true},
    VIEWPORT,
  );
  assert.ok((faded.nodes[0].props.contrast.got as number) < 1.5);
});

test('tokens: colors (list or named), spacing grid or list, fonts, font sizes', () => {
  const root = node({
    key: 'root',
    style: {backgroundColor: 'rgba(255, 255, 255, 1)', padding: 24, marginTop: 10, width: 13},
    children: [
      node({key: 'bordered', style: {borderColors: {left: 'rgba(255, 0, 0, 1)', right: 'rgba(0, 0, 0, 0)'}}}),
      text('label', 'Hi', {color: 'rgba(0, 0, 0, 1)', fontSize: 15, fontFamily: 'Inter'}),
    ],
  });
  const named = checkTree(
    root,
    {tokens: {colors: {bg: '#fff', ink: '#000'}, spacing: 8, fonts: ['System'], fontSizes: [14, 16]}},
    VIEWPORT,
  );
  assert.deepEqual(
    named.violations.map(v => [v.key, v.prop, v.actual]),
    [
      ['root', 'marginTop', 10],
      ['bordered', 'borderColors', '#ff0000'],
      ['label', 'fontFamily', 'Inter'],
      ['label', 'fontSize', 15],
    ],
  );
  const rootProps = named.nodes.find(n => n.key === 'root')!.props;
  assert.deepEqual(rootProps.backgroundColor, {rule: 'tokens', got: '#ffffff', pass: true, token: 'bg'});
  assert.deepEqual(rootProps.padding, {rule: 'tokens', got: 24, want: {multipleOf: 8}, pass: true});
  assert.equal(rootProps.width, undefined);
  assert.deepEqual(named.nodes.find(n => n.key === 'bordered')!.props.borderColors, {
    rule: 'tokens',
    got: '#ff0000',
    pass: false,
    wantToken: ['bg', 'ink'],
    wantResolved: ['#ffffff', '#000000'],
  });
  const list = checkTree(root, {tokens: {colors: ['#fff', '#000', '#f00'], spacing: [10, 24]}}, VIEWPORT);
  assert.equal(list.ok, true);
  assert.deepEqual(list.nodes.find(n => n.key === 'root')!.props.marginTop.want, [10, 24]);
});

test('--subtree scope, step violations and text output', () => {
  const root = node({
    key: 'root',
    children: [node({key: 'a', role: 'button'}), node({key: 'b', testID: 'b', children: [node({key: 'c', role: 'button'})]})],
  });
  const scoped = checkTree(root, {names: true}, {...VIEWPORT, subtree: 'testID=b'});
  assert.deepEqual(scoped.violations.map(v => v.key), ['c']);
  assert.equal(scoped.summary.nodes, 2);
  assert.throws(() => checkTree(root, {names: true}, {...VIEWPORT, subtree: 'testID=zzz'}), /no node matches/);

  const withSteps: CheckResult = addStepViolations(checkTree(root, {}, VIEWPORT), [
    {index: 0, action: 'tap'},
    {index: 1, action: 'tap', error: {code: 'TARGET_NOT_FOUND', message: 'Target not found'}},
  ]);
  assert.equal(withSteps.ok, false);
  assert.deepEqual(withSteps.violations[0], {
    rule: 'step',
    key: 'step:1',
    sel: 'tap',
    expected: 'no error',
    actual: 'TARGET_NOT_FOUND',
    message: 'step 1 (tap) failed: Target not found',
  });
  assert.equal(
    checkText(scoped),
    'FAIL names c name: button has no accessible name\nfailed: 1 violation(s), 2 of 4 nodes checked\n'.replace(
      '2 of 4',
      `${scoped.summary.checked} of ${scoped.summary.nodes}`,
    ),
  );
});

function cli(args: string[], env: Record<string, string> = {}) {
  return spawnSync('node', [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {...process.env, RN_A11Y_HOST_BIN: FAKE_HOST, FAKE_HOST_MODE: 'shadow-tree', ...env},
    maxBuffer: 64 * 1024 * 1024,
  });
}

test('CLI check: exit 2 with violations, 0 when clean, usage errors exit 1 (fake host)', {timeout: 180_000}, () => {
  const fail = cli(['check', APP, '--platform', 'android', '--rules', path.join(ROOT, 'examples/basic/rules-fail.json')]);
  assert.equal(fail.status, 2, fail.stderr);
  const result = JSON.parse(fail.stdout) as CheckResult;
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(v => v.rule === 'contrast' && v.key === 'submit/Paragraph:1'));
  const contrast = result.nodes.find(n => n.key === 'submit/Paragraph:1')!.props.contrast;
  assert.equal(contrast.bgFrom, 'ancestors'); // the fixture has no effectiveBackground

  const text = cli(['check', APP, '--platform', 'android', '--rules', path.join(ROOT, 'examples/basic/rules-fail.json'), '--format', 'text']);
  assert.equal(text.status, 2);
  assert.match(text.stdout, /^FAIL contrast submit\/Paragraph:1 contrast: contrast 4\.4:1 < 4\.5:1/m);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-check-'));
  const clean = path.join(dir, 'rules.json');
  fs.writeFileSync(clean, JSON.stringify({rules: {names: true, hiddenFocusable: true}}));
  const ok = cli(['check', APP, '--platform', 'android', '--rules', clean]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal((JSON.parse(ok.stdout) as CheckResult).ok, true);

  const missing = cli(['check', APP, '--platform', 'android']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--rules <json> is required/);
  fs.writeFileSync(clean, JSON.stringify({rules: {bogus: true}}));
  const bad = cli(['check', APP, '--platform', 'android', '--rules', clean]);
  assert.equal(bad.status, 1);
  assert.match(JSON.parse(bad.stderr).error.message, /unknown rule "bogus"/);
  const format = cli(['check', APP, '--platform', 'android', '--rules', clean, '--format', 'ndjson']);
  assert.equal(format.status, 1);

  // Default rules (and preset) from a11y-tree.json.
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p"}');
  fs.copyFileSync(APP, path.join(dir, 'App.tsx'));
  fs.writeFileSync(
    path.join(dir, 'a11y-tree.json'),
    JSON.stringify({preset: 'android-phone', format: 'text', rules: {touchTarget: {min: 48}}}),
  );
  const fromConfig = cli(['check', path.join(dir, 'App.tsx')]);
  assert.equal(fromConfig.status, 2, fromConfig.stderr);
  const configResult = JSON.parse(fromConfig.stdout) as CheckResult; // config "format" is not used by check
  assert.deepEqual(configResult.summary.byRule, {touchTarget: 2});
  fs.rmSync(dir, {recursive: true, force: true});
});

test('contrast skips text inputs under both names (AndroidTextInput, iOS TextInput)', () => {
  for (const type of ['AndroidTextInput', 'TextInput']) {
    const input = node({key: 'field', type, role: 'textbox', name: 'Email', text: 'typed', style: {color: 'rgba(200, 200, 200, 1)'}});
    const result = checkTree(node({key: 'root', children: [input]}), {contrast: true}, VIEWPORT);
    assert.equal(result.nodes.find(n => n.key === 'field')?.props.contrast, undefined, type);
  }
});
