import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
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

describe('check', () => {
  it('parseColor, composite and contrastRatio', () => {
    expect(parseColor('#1e6fff')).toStrictEqual({r: 30, g: 111, b: 255, a: 1});
    expect(parseColor('#fff')).toStrictEqual({r: 255, g: 255, b: 255, a: 1});
    expect(parseColor('#00000080')).toStrictEqual({r: 0, g: 0, b: 0, a: 128 / 255});
    expect(parseColor('rgba(30, 111, 255, 0.5)')).toStrictEqual({r: 30, g: 111, b: 255, a: 0.5});
    expect(parseColor('white')).toStrictEqual({r: 255, g: 255, b: 255, a: 1});
    expect(parseColor('hsl(0, 0%, 0%)')).toBe(null);
    expect(parseColor(42)).toBe(null);
    const white = parseColor('#fff')!;
    const black = parseColor('#000')!;
    expect(contrastRatio(black, white)).toBe(21);
    expect(Math.round(contrastRatio(white, parseColor('#1e6fff')!) * 100) / 100).toBe(4.4);
    const half = composite({...black, a: 0.5}, white);
    expect([Math.round(half.r), half.a]).toStrictEqual([128, 1]);
  });

  it('validateRules and readRulesFile reject bad rules', () => {
    expect(validateRules({names: true, touchTarget: {min: 44}}, 'x')).toStrictEqual({names: true, touchTarget: {min: 44}});
    expect(() => validateRules({colours: true}, 'x')).toThrow(/unknown rule "colours"/);
    expect(() => validateRules({touchTarget: {size: 4}}, 'x')).toThrow(/unknown option "size"/);
    expect(() => validateRules({contrast: {min: -1}}, 'x')).toThrow(/"contrast.min" must be a number > 0/);
    expect(() => validateRules({names: {ignore: ['bogus']}}, 'x')).toThrow(/invalid selector/);
    expect(() => validateRules({tokens: true}, 'x')).toThrow(/"tokens" must be an object/);
    expect(() => validateRules({tokens: {colors: ['#12']}}, 'x')).toThrow(/cannot parse color "#12"/);
    expect(() => validateRules({tokens: {spacing: 0}}, 'x')).toThrow(/tokens.spacing/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-rules-'));
    const file = path.join(dir, 'rules.json');
    fs.writeFileSync(file, JSON.stringify({names: true}));
    expect(() => readRulesFile(file)).toThrow(/expected \{"rules": \{\.\.\.\}\}/);
    fs.writeFileSync(file, '{');
    expect(() => readRulesFile(file)).toThrow(/not valid JSON/);
    fs.writeFileSync(file, JSON.stringify({$schema: 'x', rules: {names: true}}));
    expect(readRulesFile(file)).toStrictEqual({names: true});
    fs.rmSync(dir, {recursive: true, force: true});
  });

  it('names: focusable nodes and images; grouped children are skipped; placeholder counts for textbox', () => {
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
    expect(result.violations.map(v => [v.rule, v.key, v.prop])).toStrictEqual([
        ['names', 'unnamed', 'name'],
        ['names', 'icon', 'name'],
        ['names', 'logo', 'name'],
      ]);
    const field = result.nodes.find(n => n.key === 'field')!;
    expect(field.props.name).toStrictEqual({rule: 'names', got: 'Email', want: 'non-empty', pass: true, from: 'placeholder'});
    expect(result.nodes.find(n => n.key === 'inner')).toBe(undefined);
    expect(result.ok).toBe(false);
    expect(result.summary).toStrictEqual({nodes: 8, checked: 6, violations: 3, byRule: {names: 3}});
  });

  it('touchTarget: width and height of interactive nodes, with min and ignore', () => {
    const root = node({
      key: 'root',
      children: [
        node({key: 'small', role: 'button', name: 'x', box: {x: 0, y: 0, width: 60, height: 30}}),
        node({key: 'switch', role: 'switch', name: 's', testID: 'switch', box: {x: 0, y: 0, width: 51, height: 31}}),
        node({key: 'plain', box: {x: 0, y: 0, width: 1, height: 1}}),
      ],
    });
    const result = checkTree(root, {touchTarget: {min: 44, ignore: ['testID=switch']}}, VIEWPORT);
    expect(result.nodes.map(n => n.key)).toStrictEqual(['small']);
    expect(result.nodes[0].props.height).toStrictEqual({rule: 'touchTarget', got: 30, want: 44, op: '>=', pass: false});
    expect(result.nodes[0].props.width.pass).toBe(true);
    expect(result.violations[0]).toStrictEqual({
      rule: 'touchTarget',
      key: 'small',
      sel: 'small',
      prop: 'height',
      expected: '>= 44',
      actual: 30,
      message: 'touch target height 30 < 44',
    });
    // Default min 48: the switch height (31) fails too.
    expect(checkTree(root, {touchTarget: true}, VIEWPORT).violations.map(v => [v.key, v.prop])).toStrictEqual([
        ['small', 'height'],
        ['switch', 'height'],
      ]);
  });

  it('hiddenFocusable: hidden subtrees; importantForAccessibility "no" hides only the node', () => {
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
    expect(result.violations.map(v => [v.rule, v.key])).toStrictEqual([
        ['hiddenFocusable', 'trapped'],
        ['hiddenFocusable', 'self'],
      ]);
    // Hidden nodes are not checked for names.
    expect(result.nodes.find(n => n.key === 'trapped')!.props.name).toBe(undefined);
    expect(result.nodes.find(n => n.key === 'visible')!.props.name.pass).toBe(true);
  });

  it('contrast: host effectiveBackground, else ancestors composited; large text threshold', () => {
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
    expect(grey.bgFrom).toBe('ancestors');
    expect(grey.bg).toBe('#808080'); // 50% white over black
    expect(grey.got).toBe(1.01); // grey 128 on 127.5 (50% white over black)
    expect(grey.pass).toBe(false);
    const big = result.nodes.find(n => n.key === 'big')!.props.contrast;
    expect([big.bgFrom, big.bg, big.got, big.want, big.pass, big.large]).toStrictEqual(['host', '#ffffff', 4.54, 3, true, true]);
    // Semi-transparent text is composited over the background first.
    const faded = checkTree(
      node({key: 'r', children: [text('t', 'x', {color: 'rgba(0, 0, 0, 0.1)'})]}),
      {contrast: true},
      VIEWPORT,
    );
    expect((faded.nodes[0].props.contrast.got as number) < 1.5).toBeTruthy();
  });

  it('tokens: colors (list or named), spacing grid or list, fonts, font sizes', () => {
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
    expect(named.violations.map(v => [v.key, v.prop, v.actual])).toStrictEqual([
        ['root', 'marginTop', 10],
        ['bordered', 'borderColors', '#ff0000'],
        ['label', 'fontFamily', 'Inter'],
        ['label', 'fontSize', 15],
      ]);
    const rootProps = named.nodes.find(n => n.key === 'root')!.props;
    expect(rootProps.backgroundColor).toStrictEqual({rule: 'tokens', got: '#ffffff', pass: true, token: 'bg'});
    expect(rootProps.padding).toStrictEqual({rule: 'tokens', got: 24, want: {multipleOf: 8}, pass: true});
    expect(rootProps.width).toBe(undefined);
    expect(named.nodes.find(n => n.key === 'bordered')!.props.borderColors).toStrictEqual({
      rule: 'tokens',
      got: '#ff0000',
      pass: false,
      wantToken: ['bg', 'ink'],
      wantResolved: ['#ffffff', '#000000'],
    });
    const list = checkTree(root, {tokens: {colors: ['#fff', '#000', '#f00'], spacing: [10, 24]}}, VIEWPORT);
    expect(list.ok).toBe(true);
    expect(list.nodes.find(n => n.key === 'root')!.props.marginTop.want).toStrictEqual([10, 24]);
  });

  it('--subtree scope, step violations and text output', () => {
    const root = node({
      key: 'root',
      children: [node({key: 'a', role: 'button'}), node({key: 'b', testID: 'b', children: [node({key: 'c', role: 'button'})]})],
    });
    const scoped = checkTree(root, {names: true}, {...VIEWPORT, subtree: 'testID=b'});
    expect(scoped.violations.map(v => v.key)).toStrictEqual(['c']);
    expect(scoped.summary.nodes).toBe(2);
    expect(() => checkTree(root, {names: true}, {...VIEWPORT, subtree: 'testID=zzz'})).toThrow(/no node matches/);

    const withSteps: CheckResult = addStepViolations(checkTree(root, {}, VIEWPORT), [
      {index: 0, action: 'tap'},
      {index: 1, action: 'tap', error: {code: 'TARGET_NOT_FOUND', message: 'Target not found'}},
    ]);
    expect(withSteps.ok).toBe(false);
    expect(withSteps.violations[0]).toStrictEqual({
      rule: 'step',
      key: 'step:1',
      sel: 'tap',
      expected: 'no error',
      actual: 'TARGET_NOT_FOUND',
      message: 'step 1 (tap) failed: Target not found',
    });
    expect(checkText(scoped)).toBe('FAIL names c name: button has no accessible name\nfailed: 1 violation(s), 2 of 4 nodes checked\n'.replace(
        '2 of 4',
        `${scoped.summary.checked} of ${scoped.summary.nodes}`,
      ));
  });

  function cli(args: string[], env: Record<string, string> = {}) {
    return spawnSync('node', [CLI, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {...process.env, RN_A11Y_HOST_BIN: FAKE_HOST, FAKE_HOST_MODE: 'shadow-tree', ...env},
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  it('CLI check: exit 2 with violations, 0 when clean, usage errors exit 1 (fake host)', {timeout: 180_000}, () => {
    const fail = cli(['check', APP, '--platform', 'android', '--rules', path.join(ROOT, 'examples/basic/rules-fail.json')]);
    expect(fail.status, fail.stderr).toBe(2);
    const result = JSON.parse(fail.stdout) as CheckResult;
    expect(result.ok).toBe(false);
    expect(result.violations.some(v => v.rule === 'contrast' && v.key === 'submit/Paragraph:1')).toBeTruthy();
    const contrast = result.nodes.find(n => n.key === 'submit/Paragraph:1')!.props.contrast;
    expect(contrast.bgFrom).toBe('ancestors'); // the fixture has no effectiveBackground

    const text = cli(['check', APP, '--platform', 'android', '--rules', path.join(ROOT, 'examples/basic/rules-fail.json'), '--format', 'text']);
    expect(text.status).toBe(2);
    expect(text.stdout).toMatch(/^FAIL contrast submit\/Paragraph:1 contrast: contrast 4\.4:1 < 4\.5:1/m);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-check-'));
    const clean = path.join(dir, 'rules.json');
    fs.writeFileSync(clean, JSON.stringify({rules: {names: true, hiddenFocusable: true}}));
    const ok = cli(['check', APP, '--platform', 'android', '--rules', clean]);
    expect(ok.status, ok.stderr).toBe(0);
    expect((JSON.parse(ok.stdout) as CheckResult).ok).toBe(true);

    const missing = cli(['check', APP, '--platform', 'android']);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/--rules <json> is required/);
    fs.writeFileSync(clean, JSON.stringify({rules: {bogus: true}}));
    const bad = cli(['check', APP, '--platform', 'android', '--rules', clean]);
    expect(bad.status).toBe(1);
    expect(JSON.parse(bad.stderr).error.message).toMatch(/unknown rule "bogus"/);
    const format = cli(['check', APP, '--platform', 'android', '--rules', clean, '--format', 'ndjson']);
    expect(format.status).toBe(1);

    // Default rules (and preset) from a11y-tree.json.
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p"}');
    fs.copyFileSync(APP, path.join(dir, 'App.tsx'));
    fs.writeFileSync(
      path.join(dir, 'a11y-tree.json'),
      JSON.stringify({preset: 'android-phone', format: 'text', rules: {touchTarget: {min: 48}}}),
    );
    const fromConfig = cli(['check', path.join(dir, 'App.tsx')]);
    expect(fromConfig.status, fromConfig.stderr).toBe(2);
    const configResult = JSON.parse(fromConfig.stdout) as CheckResult; // config "format" is not used by check
    expect(configResult.summary.byRule).toStrictEqual({touchTarget: 2});
    fs.rmSync(dir, {recursive: true, force: true});
  });

  it('contrast skips text inputs under both names (AndroidTextInput, iOS TextInput)', () => {
    for (const type of ['AndroidTextInput', 'TextInput']) {
      const input = node({key: 'field', type, role: 'textbox', name: 'Email', text: 'typed', style: {color: 'rgba(200, 200, 200, 1)'}});
      const result = checkTree(node({key: 'root', children: [input]}), {contrast: true}, VIEWPORT);
      expect(result.nodes.find(n => n.key === 'field')?.props.contrast, type).toBe(undefined);
    }
  });
});
