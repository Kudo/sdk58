/**
 * Tool descriptors (MCP-style) for agents: one tool per CLI use case, with
 * an input schema, the output schema and an example. `bun run schema` writes
 * them to `tools/*.json`; `toolArgv()` maps a tool input to CLI arguments.
 *
 * The input types below are the source of the `inputSchema`s.
 */

import type {Action, Rules} from './schema.ts';

type Insets = {top: number; left: number; right: number; bottom: number};

/** Settings shared by all tools. Values not given come from a11y-tree.json, then the preset. */
export type CommonInput = {
  /** Component file (default export or `App` named export). */
  file: string;
  /** Device preset: platform, viewport, safe area insets, header height. */
  preset?: 'android-phone' | 'ios-phone' | 'android-tablet' | 'ios-tablet';
  /** Metro platform (`android`, `ios`, `a11ytree`, ...). Required unless a preset or a11y-tree.json sets it. */
  platform?: string;
  /** Viewport width in dp. */
  width?: number;
  /** Viewport height in dp. */
  height?: number;
  safeAreaInsets?: Insets;
  /** react-native-screens native header height in dp. */
  headerHeight?: number;
  /** Development bundle (`__DEV__ = true`). */
  dev?: boolean;
  /** Set false to skip mounted-view values (`visualBox`, `effectiveOpacity`). */
  mounted?: boolean;
};

export type TreeFormat = 'json' | 'compact' | 'text' | 'ndjson';

export type RenderInput = CommonInput & {
  /** Output format. `json` matches the output schema; `compact`/`text`/`ndjson` are smaller. */
  format?: TreeFormat;
  /** Keep `style` in `compact`/`ndjson`. */
  style?: boolean;
};

export type QueryInput = CommonInput & {
  /** Selectors `field=value` or `field~text` (testID, role, name, type, key, ref, sel, text), ANDed. */
  select?: string[];
  /** Start at the first node that matches this selector. */
  subtree?: string;
  /** Levels of children below each result (0 = the node only; the default with `select`). */
  depth?: number;
  format?: TreeFormat;
  style?: boolean;
};

export type ActInput = CommonInput & {
  /** The actions to run, in order. */
  actions: Action[];
  /** Events for taps. */
  tapMode?: 'touch' | 'click' | 'both';
  /** Add `diff` (changes by key) to each step. */
  diff?: boolean;
  format?: TreeFormat;
  /** Limit the trees in the output (snapshots and final). */
  select?: string[];
  subtree?: string;
  depth?: number;
};

export type DiffInput = CommonInput & {
  /** The actions to run; each step reports what it changed. */
  actions: Action[];
  tapMode?: 'touch' | 'click' | 'both';
  /** `text` gives one line per change (`+ key`, `- key`, `~ key field: before -> after`). */
  format?: 'json' | 'text';
};

export type CheckInput = CommonInput & {
  /** The rules; default: `rules` in a11y-tree.json. */
  rules?: Rules;
  /** Run these actions first and check the final tree. */
  actions?: Action[];
  tapMode?: 'touch' | 'click' | 'both';
  /** Check only this subtree. */
  subtree?: string;
  format?: 'json' | 'text';
};

export type SessionInput = CommonInput & {
  tapMode?: 'touch' | 'click' | 'both';
  /** Per-request timeout in ms. */
  timeout?: number;
};

export type ToolName = 'render' | 'query' | 'act' | 'diff' | 'check' | 'session';

type ToolDef = {
  name: ToolName;
  command: 'render' | 'run' | 'check' | 'session';
  inputType: string;
  /** Generated schema (schema/<file>.json) of the JSON output. */
  output: string[];
  description: string;
  example: Record<string, unknown>;
};

const BASIC = 'examples/basic/App.tsx';

export const TOOLS: ToolDef[] = [
  {
    name: 'render',
    command: 'render',
    inputType: 'RenderInput',
    output: ['render-result'],
    description:
      'Render a React Native component headlessly (real Metro bundle, Fabric layout, Hermes) and return its accessibility/layout tree: for each node the type, stable key, role, accessible name, state, on-screen box (dp), text and style. Use it to see what a screen shows and where.',
    example: {file: BASIC, preset: 'android-phone', format: 'compact'},
  },
  {
    name: 'query',
    command: 'render',
    inputType: 'QueryInput',
    output: ['query-result', 'render-result'],
    description:
      'Render a component and return only the nodes that match selectors (e.g. role=button, testID=submit, text~Sign), or one subtree. Smaller than a full render; use it to look up specific elements, their boxes and states.',
    example: {file: BASIC, platform: 'android', select: ['role=button'], format: 'text'},
  },
  {
    name: 'act',
    command: 'run',
    inputType: 'ActInput',
    output: ['run-result'],
    description:
      'Render a component, then run user actions (tap, longPress, type, scroll, pan, pinch, wait, snapshot) against elements by testID/key/sel/ref or coordinates, and return each step (target, hit node, events, errors) plus snapshots and the final tree.',
    example: {
      file: BASIC,
      platform: 'android',
      actions: [{type: {testID: 'email', text: 'a@b.c'}}, {tap: {testID: 'submit'}}],
      format: 'compact',
    },
  },
  {
    name: 'diff',
    command: 'run',
    inputType: 'DiffInput',
    output: ['run-result'],
    description:
      'Render a component, run actions, and return what each action changed in the tree (nodes added, removed, and changed box/text/name/role/state/hidden/opacity, by stable key). Use it to verify that an interaction has the expected effect.',
    example: {file: BASIC, platform: 'android', actions: [{tap: {testID: 'remember'}}], format: 'text'},
  },
  {
    name: 'check',
    command: 'check',
    inputType: 'CheckInput',
    output: ['check-result'],
    description:
      'Render a component (optionally after actions) and check accessibility and design rules: accessible names, touch target size, focusable elements in hidden subtrees, text contrast (WCAG), and design tokens (colors, spacing grid, fonts, font sizes). Returns per-node results and a list of violations; ok=false (exit code 2) when a rule fails.',
    example: {
      file: BASIC,
      platform: 'android',
      rules: {names: true, touchTarget: {min: 48}, contrast: {min: 4.5}, tokens: {spacing: 8}},
    },
  },
  {
    name: 'session',
    command: 'session',
    inputType: 'SessionInput',
    output: ['session-output-line'],
    description:
      'Start a long-running session: render once, then send JSON-line requests on stdin ({"id":1,"action":{"tap":{"testID":"submit"}}}, {"id":2,"tree":true}, {"id":3,"quit":true}) and read one JSON line per request on stdout. Use it for many actions on one app state without re-rendering.',
    example: {file: BASIC, platform: 'android'},
  },
];

function flag(name: string): string {
  return '--' + name.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
}

/**
 * CLI arguments (after `rn-a11y-tree`) for a tool input. Inline `actions`
 * and `rules` are passed as JSON strings (`--script '[...]'`, `--rules '{...}'`).
 */
export function toolArgv(name: ToolName, input: Record<string, unknown>): string[] {
  const tool = TOOLS.find(t => t.name === name);
  if (tool == null) throw new Error(`unknown tool ${name}`);
  const argv: string[] = [tool.command, String(input.file)];
  for (const [key, value] of Object.entries(input)) {
    if (key === 'file' || value === undefined) continue;
    if (key === 'actions') {
      argv.push('--script', JSON.stringify(value));
    } else if (key === 'rules') {
      argv.push('--rules', JSON.stringify({rules: value}));
    } else if (key === 'mounted') {
      if (value === false) argv.push('--no-mounted');
    } else if (key === 'select') {
      for (const selector of value as string[]) argv.push('--select', selector);
    } else if (key === 'safeAreaInsets') {
      const insets = value as Insets;
      argv.push(flag(key), [insets.top, insets.left, insets.right, insets.bottom].join(','));
    } else if (typeof value === 'boolean') {
      if (value) argv.push(flag(key));
    } else {
      argv.push(flag(key), String(value));
    }
  }
  if (name === 'diff') argv.push('--diff');
  return argv;
}
