/**
 * Validation of `run --script` files. Runs in the CLI before bundling so
 * errors are reported with the step index. Keep in sync with
 * runtime/actions.ts and the README "Interactions" section.
 */

export type Target = {testID: string} | {ref: string} | {key: string} | {sel: string};
export type Point = {x: number; y: number};

export type Action =
  | {tap: Target | Point}
  | {longPress: Target | Point}
  | {type: Target & {text: string; submit?: boolean}}
  | {scroll: Target & {x?: number; y?: number}}
  | {pan: (Target | Point) & {dx?: number; dy?: number; steps?: number; durationMs?: number}}
  | {pinch: Target & {scale: number; steps?: number; durationMs?: number}}
  | {wait: number}
  | {snapshot: string};

export const ACTION_NAMES = [
  'tap',
  'longPress',
  'type',
  'scroll',
  'pan',
  'pinch',
  'wait',
  'snapshot',
] as const;

/** One line per action for `--help` (keep in sync with validateScript). TARGET is one of testID/ref/key/sel. */
export const ACTION_SYNTAX: ReadonlyArray<readonly [(typeof ACTION_NAMES)[number], string]> = [
  ['tap', '{"tap": TARGET} or {"tap": {"x": 10, "y": 20}}'],
  ['longPress', '{"longPress": TARGET} or {"longPress": {"x": 10, "y": 20}}'],
  ['type', '{"type": {TARGET, "text": "a@b.c", "submit"?: true}}'],
  ['scroll', '{"scroll": {TARGET, "x"?: 0, "y"?: 600}}'],
  ['pan', '{"pan": {TARGET or "x", "y", "dx"?: 100, "dy"?: 0, "steps"?: 10, "durationMs"?: 300}} (dx and/or dy)'],
  ['pinch', '{"pinch": {TARGET, "scale": 2, "steps"?: 10, "durationMs"?: 300}}'],
  ['wait', '{"wait": 300} (milliseconds)'],
  ['snapshot', '{"snapshot": "after-submit"} (unique name)'],
];

/** `--help` text: the script file forms and every action. */
export function scriptHelp(): string {
  const width = Math.max(...ACTION_SYNTAX.map(([name]) => name.length));
  return [
    'Script (--script): a file or inline JSON, either',
    '  {"$schema": "./node_modules/react-native-a11y-tree/schema/script.json", "actions": [ACTION, ...]}',
    '  or a bare array [ACTION, ...]. Full schema: rn-a11y-tree schema script',
    'Actions (TARGET = exactly one of "testID", "ref" ("n5"), "key", "sel"):',
    ...ACTION_SYNTAX.map(([name, syntax]) => `  ${name.padEnd(width)}  ${syntax}`),
  ].join('\n');
}

export class ScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function checkKeys(
  spec: Record<string, unknown>,
  allowed: string[],
  fail: (msg: string) => never,
) {
  for (const key of Object.keys(spec)) {
    if (!allowed.includes(key)) {
      fail(`unknown key "${key}" (allowed: ${allowed.join(', ')})`);
    }
  }
}

const TARGET_KEYS = ['testID', 'ref', 'key', 'sel'];

/** Exactly one of `testID` / `ref` / `key` / `sel`. */
function checkTarget(spec: Record<string, unknown>, fail: (msg: string) => never) {
  const present = TARGET_KEYS.filter(k => k in spec);
  if (present.length !== 1) {
    fail('needs exactly one of "testID", "ref", "key" or "sel"');
  }
  const [k] = present;
  if (k === 'ref') {
    if (!(typeof spec.ref === 'string' && /^n\d+$/.test(spec.ref))) fail('"ref" must look like "n5"');
  } else if (!nonEmptyString(spec[k])) {
    fail(`"${k}" must be a non-empty string`);
  }
}

/** Accepts the object form `{"$schema"?, "actions": [...]}` or a bare array; returns the actions. */
export function validateScript(input: unknown): Action[] {
  let value = input;
  if (isObject(input)) {
    checkKeys(input, ['$schema', 'actions'], msg => {
      throw new ScriptError(msg);
    });
    if ('$schema' in input && typeof input.$schema !== 'string') {
      throw new ScriptError('"$schema" must be a string');
    }
    value = input.actions;
  }
  if (!Array.isArray(value)) {
    throw new ScriptError('script must be {"actions": [...]} or a JSON array of actions');
  }
  const snapshotNames = new Set<string>();

  value.forEach((action, index) => {
    const fail = (msg: string): never => {
      throw new ScriptError(`step ${index}: ${msg}`);
    };
    if (!isObject(action)) {
      fail('must be an object like {"tap": {...}}');
    }
    const keys = Object.keys(action);
    if (keys.length !== 1) {
      fail(`must have exactly one action key (one of: ${ACTION_NAMES.join(', ')})`);
    }
    const name = keys[0];
    const spec = action[name];
    const failIn = (msg: string): never => fail(`${name}: ${msg}`);

    switch (name) {
      case 'tap':
      case 'longPress': {
        if (!isObject(spec)) failIn('must be an object');
        const s = spec as Record<string, unknown>;
        if ('x' in s || 'y' in s) {
          checkKeys(s, ['x', 'y'], failIn);
          if (!isFiniteNumber(s.x) || !isFiniteNumber(s.y)) {
            failIn('"x" and "y" must both be numbers');
          }
        } else {
          checkKeys(s, TARGET_KEYS, failIn);
          checkTarget(s, failIn);
        }
        break;
      }
      case 'type': {
        if (!isObject(spec)) failIn('must be an object');
        const s = spec as Record<string, unknown>;
        checkKeys(s, [...TARGET_KEYS, 'text', 'submit'], failIn);
        checkTarget(s, failIn);
        if (typeof s.text !== 'string') failIn('"text" must be a string');
        if ('submit' in s && typeof s.submit !== 'boolean') {
          failIn('"submit" must be a boolean');
        }
        break;
      }
      case 'scroll': {
        if (!isObject(spec)) failIn('must be an object');
        const s = spec as Record<string, unknown>;
        checkKeys(s, [...TARGET_KEYS, 'x', 'y'], failIn);
        checkTarget(s, failIn);
        for (const key of ['x', 'y']) {
          if (key in s && !isFiniteNumber(s[key])) failIn(`"${key}" must be a number`);
        }
        break;
      }
      case 'pan': {
        if (!isObject(spec)) failIn('must be an object');
        const s = spec as Record<string, unknown>;
        const extras = ['dx', 'dy', 'steps', 'durationMs'];
        if ('x' in s || 'y' in s) {
          checkKeys(s, ['x', 'y', ...extras], failIn);
          if (!isFiniteNumber(s.x) || !isFiniteNumber(s.y)) {
            failIn('"x" and "y" must both be numbers');
          }
        } else {
          checkKeys(s, [...TARGET_KEYS, ...extras], failIn);
          checkTarget(s, failIn);
        }
        for (const key of ['dx', 'dy', 'durationMs']) {
          if (key in s && !isFiniteNumber(s[key])) failIn(`"${key}" must be a number`);
        }
        if ('durationMs' in s && (s.durationMs as number) <= 0) failIn('"durationMs" must be > 0');
        if ('steps' in s && !(Number.isInteger(s.steps) && (s.steps as number) >= 1)) {
          failIn('"steps" must be an integer >= 1');
        }
        if (!('dx' in s) && !('dy' in s)) failIn('needs "dx" and/or "dy"');
        break;
      }
      case 'pinch': {
        if (!isObject(spec)) failIn('must be an object');
        const s = spec as Record<string, unknown>;
        checkKeys(s, [...TARGET_KEYS, 'scale', 'steps', 'durationMs'], failIn);
        checkTarget(s, failIn);
        if (!isFiniteNumber(s.scale) || s.scale <= 0) failIn('"scale" must be a number > 0');
        if ('durationMs' in s && !(isFiniteNumber(s.durationMs) && s.durationMs > 0)) {
          failIn('"durationMs" must be a number > 0');
        }
        if ('steps' in s && !(Number.isInteger(s.steps) && (s.steps as number) >= 1)) {
          failIn('"steps" must be an integer >= 1');
        }
        break;
      }
      case 'wait':
        if (!isFiniteNumber(spec) || spec < 0) {
          failIn('must be a number of milliseconds >= 0');
        }
        break;
      case 'snapshot':
        if (!nonEmptyString(spec)) failIn('must be a non-empty name');
        if (snapshotNames.has(spec as string)) {
          failIn(`duplicate snapshot name "${spec}"`);
        }
        snapshotNames.add(spec as string);
        break;
      default:
        fail(`unknown action "${name}" (one of: ${ACTION_NAMES.join(', ')})`);
    }
  });

  return value as Action[];
}
