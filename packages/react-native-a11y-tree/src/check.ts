/**
 * `rn-a11y-tree check`: evaluates accessibility and design-token rules on a
 * rendered tree.
 *
 * Rules file: `{"rules": {names, touchTarget, hiddenFocusable, contrast, tokens}}`.
 * Each rule is `true`/`false` or an object; every object rule accepts
 * `ignore: [selector, ...]` (see `--select`) to skip nodes.
 */

import fs from 'node:fs';

import {type LogEntry, usage} from './errors.ts';
import {parseSelector} from './format.ts';
import type {TreeNode} from './schema.ts';
import {TEXT_INPUT_TYPES} from './tree.ts';

type Ignore = {ignore?: string[]};

export type Rules = {
  /** Focusable nodes and images need an accessible name. */
  names?: boolean | Ignore;
  /** Interactive nodes are at least `min` x `min` dp (default 48). */
  touchTarget?: boolean | ({min?: number} & Ignore);
  /** No focusable node inside a hidden subtree. */
  hiddenFocusable?: boolean | Ignore;
  /** Text contrast ratio (WCAG 2.x) at least `min` (default 4.5); `minLarge` for large text. */
  contrast?: boolean | ({min?: number; minLarge?: number} & Ignore);
  tokens?: {
    /** Allowed colors: a list, or token name -> color. */
    colors?: string[] | Record<string, string>;
    /** Margins, paddings and gaps: a grid step (multiple of) or a list of values. */
    spacing?: number | number[];
    /** Allowed font families; `"System"` stands for no fontFamily. */
    fonts?: string[];
    /** Allowed font sizes. */
    fontSizes?: number[];
  } & Ignore;
};

export type RulesFile = {rules: Rules};

export type RuleName = 'names' | 'touchTarget' | 'hiddenFocusable' | 'contrast' | 'tokens';

/** One evaluated property: what the node has, what the rule wants, and the verdict. */
export type PropCheck = {
  rule: RuleName;
  got: unknown;
  want?: unknown;
  wantToken?: string | string[];
  wantResolved?: unknown;
  pass: boolean;
  [extra: string]: unknown;
};

export type CheckedNode = {
  ref: string;
  key: string;
  sel: string;
  props: Record<string, PropCheck>;
};

export type Violation = {
  rule: RuleName | 'step';
  key: string;
  sel: string;
  prop?: string;
  expected: unknown;
  actual: unknown;
  message: string;
};

export type CheckResult = {
  ok: boolean;
  viewport: {width: number; height: number};
  source: string;
  summary: {nodes: number; checked: number; violations: number; byRule: Partial<Record<RuleName | 'step', number>>};
  nodes: CheckedNode[];
  violations: Violation[];
  logs?: LogEntry[];
};

// --- rules file -------------------------------------------------------------

const RULE_NAMES: RuleName[] = ['names', 'touchTarget', 'hiddenFocusable', 'contrast', 'tokens'];

const RULE_KEYS: Record<RuleName, string[]> = {
  names: ['ignore'],
  touchTarget: ['min', 'ignore'],
  hiddenFocusable: ['ignore'],
  contrast: ['min', 'minLarge', 'ignore'],
  tokens: ['colors', 'spacing', 'fonts', 'fontSizes', 'ignore'],
};

/** Validates a parsed rules object; `where` prefixes error messages. */
export function validateRules(json: unknown, where: string): Rules {
  const fail = (message: string) => usage(`${where}: ${message}`);
  if (typeof json !== 'object' || json == null || Array.isArray(json)) throw fail('must be a JSON object');
  const rules = json as Record<string, unknown>;
  for (const [name, value] of Object.entries(rules)) {
    if (!RULE_NAMES.includes(name as RuleName)) {
      throw fail(`unknown rule "${name}" (rules: ${RULE_NAMES.join(', ')})`);
    }
    if (typeof value === 'boolean' && name !== 'tokens') continue;
    if (typeof value !== 'object' || value == null || Array.isArray(value)) {
      throw fail(`"${name}" must be ${name === 'tokens' ? 'an object' : 'true, false or an object'}`);
    }
    const options = value as Record<string, unknown>;
    for (const key of Object.keys(options)) {
      if (!RULE_KEYS[name as RuleName].includes(key)) {
        throw fail(`"${name}": unknown option "${key}" (allowed: ${RULE_KEYS[name as RuleName].join(', ')})`);
      }
    }
    for (const key of ['min', 'minLarge']) {
      if (key in options && !(typeof options[key] === 'number' && (options[key] as number) > 0)) {
        throw fail(`"${name}.${key}" must be a number > 0`);
      }
    }
    if ('ignore' in options) {
      if (!Array.isArray(options.ignore) || options.ignore.some(s => typeof s !== 'string')) {
        throw fail(`"${name}.ignore" must be an array of selectors`);
      }
      for (const selector of options.ignore as string[]) {
        try {
          parseSelector(selector);
        } catch (error) {
          throw fail(`"${name}.ignore": ${(error as Error).message}`);
        }
      }
    }
    if (name === 'tokens') validateTokens(options, fail);
  }
  return rules as Rules;
}

function validateTokens(tokens: Record<string, unknown>, fail: (m: string) => Error) {
  if ('colors' in tokens) {
    const colors = tokens.colors;
    const values = Array.isArray(colors)
      ? colors
      : typeof colors === 'object' && colors != null
        ? Object.values(colors)
        : null;
    if (values == null) throw fail('"tokens.colors" must be an array or an object of name -> color');
    for (const color of values) {
      if (typeof color !== 'string' || parseColor(color) == null) {
        throw fail(`"tokens.colors": cannot parse color ${JSON.stringify(color)}`);
      }
    }
  }
  if ('spacing' in tokens) {
    const spacing = tokens.spacing;
    const ok =
      (typeof spacing === 'number' && spacing > 0) ||
      (Array.isArray(spacing) && spacing.every(n => typeof n === 'number'));
    if (!ok) throw fail('"tokens.spacing" must be a number > 0 (grid step) or an array of numbers');
  }
  if ('fonts' in tokens && !(Array.isArray(tokens.fonts) && tokens.fonts.every(f => typeof f === 'string'))) {
    throw fail('"tokens.fonts" must be an array of font family names');
  }
  if (
    'fontSizes' in tokens &&
    !(Array.isArray(tokens.fontSizes) && tokens.fontSizes.every(n => typeof n === 'number'))
  ) {
    throw fail('"tokens.fontSizes" must be an array of numbers');
  }
}

/** Reads a rules file: `{"rules": {...}}`. A value that starts with `{` is the JSON itself. */
export function readRulesFile(file: string): Rules {
  const inline = file.trimStart().startsWith('{');
  let text: string;
  try {
    text = inline ? file : fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw usage(`cannot read ${file}: ${(error as Error).message}`);
  }
  if (inline) file = '--rules';
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw usage(`${file} is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof json !== 'object' || json == null || !('rules' in json)) {
    throw usage(`${file}: expected {"rules": {...}}`);
  }
  const extra = Object.keys(json).filter(k => k !== 'rules' && k !== '$schema');
  if (extra.length > 0) throw usage(`${file}: unknown key "${extra[0]}" (expected {"rules": {...}})`);
  return validateRules((json as RulesFile).rules, file);
}

// --- colors -----------------------------------------------------------------

export type RGBA = {r: number; g: number; b: number; a: number};

const NAMED_COLORS: Record<string, string> = {
  transparent: 'rgba(0, 0, 0, 0)',
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
};

/** Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()` and a few names. */
export function parseColor(value: unknown): RGBA | null {
  if (typeof value !== 'string') return null;
  const text = NAMED_COLORS[value.trim().toLowerCase()] ?? value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) digits = [...digits].map(d => d + d).join('');
    const n = (i: number) => parseInt(digits.slice(i, i + 2), 16);
    return {r: n(0), g: n(2), b: n(4), a: digits.length === 8 ? n(6) / 255 : 1};
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(text);
  if (fn) {
    return {r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: fn[4] == null ? 1 : Number(fn[4])};
  }
  return null;
}

/** Same color, alpha compared to 2 decimals (the host prints 3 significant digits). */
function sameColor(a: RGBA, b: RGBA): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && Math.abs(a.a - b.a) < 0.01;
}

/** `top` drawn over `bottom` (source-over). */
export function composite(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return {r: 0, g: 0, b: 0, a: 0};
  const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return {r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a};
}

export function formatColor(c: RGBA): string {
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  const rgb = `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
  return c.a >= 0.999 ? rgb : `${rgb}${hex(c.a * 255)}`;
}

function luminance(c: RGBA): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG 2.x contrast ratio of two opaque colors. */
export function contrastRatio(a: RGBA, b: RGBA): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The host window background. */
const WINDOW_BACKGROUND: RGBA = {r: 255, g: 255, b: 255, a: 1};

// --- evaluation ---------------------------------------------------------------

/** Roles a screen reader user can act on (and that get a touch target). */
export const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'switch',
  'checkbox',
  'radio',
  'tab',
  'menuitem',
  'textbox',
  'searchbox',
  'search',
  'slider',
  'adjustable',
  'combobox',
  'spinbutton',
  'togglebutton',
  'imagebutton',
  'keyboardkey',
]);

const SPACING_KEY =
  /^(margin|padding)(Top|Bottom|Left|Right|Start|End|Horizontal|Vertical|Block|BlockStart|BlockEnd|Inline|InlineStart|InlineEnd)?$|^(gap|rowGap|columnGap)$/;

type Context = {
  node: TreeNode;
  inScope: boolean;
  ancestors: TreeNode[];
  /** Inside a node with `accessible: true` (grouped into it for screen readers). */
  grouped: boolean;
  /** Hidden from screen readers (itself or by an ancestor). */
  hidden: boolean;
  /** An ancestor hides its descendants. */
  hiddenByAncestor: boolean;
};

function isFocusable(node: TreeNode): boolean {
  return (node.role != null && INTERACTIVE_ROLES.has(node.role)) || node.a11y.accessible === true;
}

function ruleOptions<T extends object>(value: boolean | T | undefined): (T & Ignore) | null {
  if (value == null || value === false) return null;
  return (value === true ? {} : value) as T & Ignore;
}

function ignoredBy(options: Ignore | null): (node: TreeNode) => boolean {
  const predicates = (options?.ignore ?? []).map(parseSelector);
  return node => predicates.some(p => p(node));
}

function backgroundOf(ctx: Context): {color: RGBA; from: 'host' | 'ancestors'} {
  const host = parseColor(ctx.node.style.effectiveBackground);
  if (host) return {color: host, from: 'host'};
  let color = WINDOW_BACKGROUND;
  for (const node of [...ctx.ancestors, ctx.node]) {
    const own = parseColor(node.style.backgroundColor);
    if (own && own.a > 0) color = composite(own, color);
  }
  return {color, from: 'ancestors'};
}

function colorValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'object' && value != null) {
    return [...new Set(Object.values(value).filter((v): v is string => typeof v === 'string'))];
  }
  return [];
}

/** Large text (WCAG): at least 18 pt, or 14 pt bold; 1 pt = 4/3 dp. */
function isLargeText(style: Record<string, unknown>): boolean {
  const size = typeof style.fontSize === 'number' ? style.fontSize : 14;
  const weight = Number(style.fontWeight ?? 400);
  return size >= 24 || (size >= 18.66 && weight >= 700);
}

export function checkTree(
  root: TreeNode,
  rules: Rules,
  info: {viewport: {width: number; height: number}; source: string; subtree?: string},
): CheckResult {
  // --subtree: evaluate only the first match and its descendants (ancestors
  // still count for backgrounds, grouping and hiding).
  let scope: TreeNode | null = root;
  if (info.subtree != null) {
    const predicate = parseSelector(info.subtree);
    const find = (node: TreeNode): TreeNode | null =>
      predicate(node) ? node : node.children.reduce<TreeNode | null>((found, c) => found ?? find(c), null);
    scope = find(root);
    if (scope == null) throw usage(`--subtree: no node matches "${info.subtree}"`);
  }
  const names = ruleOptions(rules.names);
  const touchTarget = ruleOptions(rules.touchTarget);
  const hiddenFocusable = ruleOptions(rules.hiddenFocusable);
  const contrast = ruleOptions(rules.contrast);
  const tokens = rules.tokens ?? null;
  const ignored = {
    names: ignoredBy(names),
    touchTarget: ignoredBy(touchTarget),
    hiddenFocusable: ignoredBy(hiddenFocusable),
    contrast: ignoredBy(contrast),
    tokens: ignoredBy(tokens),
  };

  const tokenColors: Array<{name: string | null; value: string; rgba: RGBA}> = [];
  if (tokens?.colors) {
    const entries = Array.isArray(tokens.colors)
      ? tokens.colors.map(value => [null, value] as const)
      : Object.entries(tokens.colors);
    for (const [name, value] of entries) tokenColors.push({name, value, rgba: parseColor(value)!});
  }

  const nodes: CheckedNode[] = [];
  const violations: Violation[] = [];
  let count = 0;

  const visit = (ctx: Context) => {
    const {node} = ctx;
    if (!ctx.inScope) {
      for (const child of node.children) visit(childContext(ctx, child));
      return;
    }
    count++;
    const props: Record<string, PropCheck> = {};
    const add = (prop: string, check: PropCheck, expected: unknown, message: string) => {
      props[prop] = check;
      if (!check.pass) {
        violations.push({rule: check.rule, key: node.key, sel: node.sel, prop, expected, actual: check.got, message});
      }
    };
    const focusable = isFocusable(node) && !ctx.grouped && !node.virtual;
    const interactive = node.role != null && INTERACTIVE_ROLES.has(node.role);

    if (names && !ctx.hidden && !ignored.names(node) && (focusable || (node.role === 'image' && !ctx.grouped))) {
      const placeholder = node.role === 'textbox' && typeof node.style.placeholder === 'string' ? node.style.placeholder : null;
      const got = node.name ?? (placeholder || null);
      const check: PropCheck = {rule: 'names', got, want: 'non-empty', pass: got != null && got.trim() !== ''};
      if (node.name == null && placeholder) check.from = 'placeholder';
      add('name', check, 'non-empty accessible name', `${node.role ?? node.type} has no accessible name`);
    }

    if (touchTarget && interactive && !ctx.hidden && !ctx.grouped && !ignored.touchTarget(node)) {
      const min = touchTarget.min ?? 48;
      for (const dim of ['width', 'height'] as const) {
        const got = node.box[dim];
        add(
          dim,
          {rule: 'touchTarget', got, want: min, op: '>=', pass: got >= min},
          `>= ${min}`,
          `touch target ${dim} ${got} < ${min}`,
        );
      }
    }

    if (hiddenFocusable && ctx.hidden && focusable && !ignored.hiddenFocusable(node)) {
      add(
        'hidden',
        {rule: 'hiddenFocusable', got: true, want: false, pass: false, focusable: true},
        'not hidden (or not focusable)',
        `focusable ${node.role ?? node.type} is hidden from screen readers`,
      );
    }

    const fg = parseColor(node.style.color);
    const hasText = node.text != null && node.text.trim() !== '' && !TEXT_INPUT_TYPES.has(node.type);
    if (contrast && hasText && fg && !ctx.hidden && !ignored.contrast(node)) {
      const large = isLargeText(node.style);
      const min = large && contrast.minLarge != null ? contrast.minLarge : (contrast.min ?? 4.5);
      const bg = backgroundOf(ctx);
      const ratio = Math.round(contrastRatio(composite(fg, bg.color), bg.color) * 100) / 100;
      add(
        'contrast',
        {
          rule: 'contrast',
          got: ratio,
          want: min,
          op: '>=',
          pass: ratio >= min,
          fg: formatColor(fg),
          bg: formatColor(bg.color),
          bgFrom: bg.from,
          ...(large ? {large: true} : {}),
        },
        `>= ${min}`,
        `contrast ${ratio}:1 < ${min}:1 (${formatColor(fg)} on ${formatColor(bg.color)})`,
      );
    }

    if (tokens && !ignored.tokens(node)) {
      if (tokenColors.length > 0) {
        for (const prop of ['color', 'backgroundColor', 'borderColors']) {
          for (const value of colorValues(node.style[prop])) {
            const rgba = parseColor(value);
            if (rgba == null || rgba.a === 0) continue;
            const match = tokenColors.find(t => sameColor(t.rgba, rgba));
            const check: PropCheck = {rule: 'tokens', got: formatColor(rgba), pass: match != null};
            if (match) {
              if (match.name != null) check.token = match.name;
            } else {
              const named = tokenColors.filter(t => t.name != null);
              if (named.length > 0) check.wantToken = named.map(t => t.name!);
              check.wantResolved = tokenColors.map(t => formatColor(t.rgba));
            }
            add(prop, check, 'a token color', `${prop} ${formatColor(rgba)} is not a token color`);
          }
        }
      }
      if (tokens.spacing != null) {
        const spacing = tokens.spacing;
        for (const [prop, value] of Object.entries(node.style)) {
          if (!SPACING_KEY.test(prop) || typeof value !== 'number' || value === 0) continue;
          const pass = Array.isArray(spacing) ? spacing.includes(value) : Number.isInteger(value / spacing);
          const want = Array.isArray(spacing) ? spacing : {multipleOf: spacing};
          add(
            prop,
            {rule: 'tokens', got: value, want, pass},
            want,
            `${prop} ${value} is not ${Array.isArray(spacing) ? `one of ${spacing.join(', ')}` : `a multiple of ${spacing}`}`,
          );
        }
      }
      if (node.type === 'Paragraph' && hasText) {
        if (tokens.fonts) {
          const got = typeof node.style.fontFamily === 'string' ? node.style.fontFamily : 'System';
          add(
            'fontFamily',
            {rule: 'tokens', got, want: tokens.fonts, pass: tokens.fonts.includes(got)},
            tokens.fonts,
            `fontFamily ${got} is not one of ${tokens.fonts.join(', ')}`,
          );
        }
        if (tokens.fontSizes && typeof node.style.fontSize === 'number') {
          const got = node.style.fontSize;
          add(
            'fontSize',
            {rule: 'tokens', got, want: tokens.fontSizes, pass: tokens.fontSizes.includes(got)},
            tokens.fontSizes,
            `fontSize ${got} is not one of ${tokens.fontSizes.join(', ')}`,
          );
        }
      }
    }

    if (Object.keys(props).length > 0) nodes.push({ref: node.ref, key: node.key, sel: node.sel, props});

    for (const child of node.children) visit(childContext(ctx, child));
  };
  const childContext = (ctx: Context, child: TreeNode): Context => {
    const {node} = ctx;
    // importantForAccessibility "no" hides only the node itself.
    const hidesChildren =
      ctx.hiddenByAncestor || (node.a11y.hidden === true && node.a11y.raw?.importantForAccessibility !== 'no');
    return {
      node: child,
      inScope: ctx.inScope || child === scope,
      ancestors: [...ctx.ancestors, node],
      grouped: ctx.grouped || node.a11y.accessible === true,
      hidden: hidesChildren || child.a11y.hidden === true,
      hiddenByAncestor: hidesChildren,
    };
  };
  visit({
    node: root,
    inScope: root === scope,
    ancestors: [],
    grouped: false,
    hidden: root.a11y.hidden === true,
    hiddenByAncestor: false,
  });

  return finish({viewport: info.viewport, source: info.source, nodes, violations, count});
}

function finish(parts: {
  viewport: {width: number; height: number};
  source: string;
  nodes: CheckedNode[];
  violations: Violation[];
  count: number;
}): CheckResult {
  const byRule: CheckResult['summary']['byRule'] = {};
  for (const v of parts.violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;
  return {
    ok: parts.violations.length === 0,
    viewport: parts.viewport,
    source: parts.source,
    summary: {nodes: parts.count, checked: parts.nodes.length, violations: parts.violations.length, byRule},
    nodes: parts.nodes,
    violations: parts.violations,
  };
}

/** Adds one violation per failed `run` step (the tree after a failed step may not be the one to check). */
export function addStepViolations(
  result: CheckResult,
  steps: Array<{index: number; action: string; error?: {code: string; message: string} | string}>,
): CheckResult {
  const violations = [...result.violations];
  for (const step of steps) {
    if (step.error == null) continue;
    const error = typeof step.error === 'string' ? {code: 'APP_THREW', message: step.error} : step.error;
    violations.push({
      rule: 'step',
      key: `step:${step.index}`,
      sel: step.action,
      expected: 'no error',
      actual: error.code,
      message: `step ${step.index} (${step.action}) failed: ${error.message}`,
    });
  }
  return finish({...result, count: result.summary.nodes, violations});
}

/** `--format text`: one line per violation, then a summary line. */
export function checkText(result: CheckResult): string {
  const lines = result.violations.map(v => `FAIL ${v.rule} ${v.key}${v.prop ? ` ${v.prop}` : ''}: ${v.message}`);
  const {nodes, checked, violations} = result.summary;
  lines.push(`${result.ok ? 'ok' : 'failed'}: ${violations} violation(s), ${checked} of ${nodes} nodes checked`);
  return lines.join('\n') + '\n';
}
