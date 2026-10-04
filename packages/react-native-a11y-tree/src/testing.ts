import {afterEach, beforeEach, expect} from 'vitest';
import {formatRender} from './format.ts';
import type {TreeNode} from './schema.ts';
import {TestSession, type RenderOptions} from './testingClient.ts';
import {flattenTree, isElementDisabled, isElementVisible, matchesText, normalizeText, queryNodes, textContent, type QueryKind, type QueryOptions, type TextMatch} from './testingQueries.ts';

export {test, it, describe, expect, beforeAll, beforeEach, afterAll, afterEach} from 'vitest';
export type {RenderOptions, TextMatch, QueryOptions};
export type TestElement = TreeNode;

let session: TestSession | undefined;
const owners = new WeakMap<TreeNode, {session: TestSession; tag: number | undefined}>();

beforeEach(context => {
  if (context.task.concurrent) throw new Error('a11y-tree tests share screen within a file; use sequential tests');
});
afterEach(async () => { await cleanup(); }, 15_000);

export async function cleanup() {
  const previous = session;
  session = undefined;
  await previous?.close();
}

async function mount(file: string | undefined, route: string | undefined, options: RenderOptions) {
  await cleanup();
  session = new TestSession(file, route, options);
  try { await session.start(); }
  catch (error) { await cleanup().catch(() => {}); throw error; }
  return screen;
}

/** Components are loaded by Metro in Hermes; pass their file rather than importing native code into Node. */
export async function render(file: string, options: RenderOptions = {}) {
  return mount(file, undefined, options);
}

export async function renderRoute(route: string, options: RenderOptions = {}) {
  if (!route.startsWith('/')) throw new Error('renderRoute() requires an absolute route such as /notes');
  return mount(undefined, route, options);
}

function currentSession() {
  if (!session) throw new Error('Render an app before using screen or user');
  return session;
}

function remember(nodes: TreeNode[]) {
  const active = currentSession();
  for (const node of nodes) owners.set(node, {session: active, tag: active.nodeTags[node.ref]});
  return nodes;
}

function resolveElement(element: TreeNode): TreeNode {
  const active = currentSession();
  const owner = owners.get(element);
  if (owner?.session !== active) throw new Error('Element belongs to an earlier render; query screen again');
  if (flattenTree(active.tree).includes(element)) return element;
  const matches = flattenTree(active.tree).filter(node => owner.tag !== undefined && active.nodeTags[node.ref] === owner.tag);
  if (matches.length !== 1) throw new Error('Element is no longer uniquely present; query screen again');
  return matches[0];
}

function debugTree() {
  const active = currentSession();
  return formatRender({root: active.tree, viewport: active.tree.box, source: 'shadowTree'}, {format: 'text'});
}

function query(kind: QueryKind, match: TextMatch, options: QueryOptions, all: boolean, optional: boolean) {
  const nodes = queryNodes(currentSession().tree, kind, match, options);
  if ((!all && nodes.length > 1) || (!optional && nodes.length === 0)) {
    throw new Error(`Expected ${all ? 'at least one' : optional ? 'at most one' : 'one'} element by ${kind} ${String(match)}${options.name === undefined ? '' : ` with name ${String(options.name)}`}, found ${nodes.length}\n${debugTree().slice(0,2000)}`);
  }
  remember(nodes);
  return all ? nodes : nodes[0] ?? null;
}

export type WaitOptions = {timeout?: number; interval?: number};

async function find(kind: QueryKind, match: TextMatch, options: QueryOptions, all: boolean, wait: WaitOptions) {
  const timeout = wait.timeout ?? 2000;
  const interval = wait.interval ?? 50;
  if (!Number.isFinite(timeout) || timeout < 0 || !Number.isFinite(interval) || interval <= 0) throw new Error('Wait timeout must be non-negative and interval must be positive');
  const active = currentSession();
  const deadline = performance.now() + timeout;
  let elapsed = 0;
  while (true) {
    await active.refresh();
    try { return query(kind, match, options, all, false); }
    catch (error) {
      if (elapsed >= timeout || performance.now() >= deadline) throw error;
    }
    const step = Math.min(interval, timeout - elapsed);
    await active.request({action: {wait: step}});
    // Let live network replies arrive while advancing the deterministic app clock.
    await new Promise(resolve => setTimeout(resolve, step));
    elapsed += step;
  }
}

type SingleQuery = (match: TextMatch, options?: QueryOptions) => TreeNode;
type OptionalQuery = (match: TextMatch, options?: QueryOptions) => TreeNode | null;
type AllQuery = (match: TextMatch, options?: QueryOptions) => TreeNode[];
type FindQuery = (match: TextMatch, options?: QueryOptions, wait?: WaitOptions) => Promise<TreeNode>;
type FindAllQuery = (match: TextMatch, options?: QueryOptions, wait?: WaitOptions) => Promise<TreeNode[]>;
type Queries = {[K in QueryKind as `getBy${K}`]: SingleQuery}
  & {[K in QueryKind as `queryBy${K}`]: OptionalQuery}
  & {[K in QueryKind as `getAllBy${K}` | `queryAllBy${K}`]: AllQuery}
  & {[K in QueryKind as `findBy${K}`]: FindQuery}
  & {[K in QueryKind as `findAllBy${K}`]: FindAllQuery};

const queries: Record<string, unknown> = {};
for (const kind of ['TestId', 'Role', 'Text', 'LabelText'] as const) {
  for (const variant of ['get', 'query', 'find'] as const) {
    for (const all of [false, true]) {
      queries[`${variant}${all ? 'All' : ''}By${kind}`] = (match: TextMatch, options: QueryOptions = {}, wait: WaitOptions = {}) =>
        variant === 'find' ? find(kind, match, options, all, wait) : query(kind, match, options, all, variant === 'query');
    }
  }
}

export const screen = {
  ...queries,
  debug() { console.log(debugTree()); },
} as Queries & {debug: () => void};

async function act(name: 'tap' | 'longPress' | 'type' | 'scroll' | 'pan', element: TreeNode, fields: Record<string, unknown> = {}) {
  const active = currentSession();
  const node = resolveElement(element);
  if (isElementDisabled(active.tree, node)) throw new Error(`Cannot ${name} disabled element ${node.testID ?? node.name ?? node.ref}`);
  const response = await active.request({action: {[name]: {ref: node.ref, ...fields}}, strict: true});
  await active.refresh();
  const covered = response.step?.warnings?.find(warning => /Target is covered|Nothing is hittable/.test(warning));
  if (covered) throw new Error(`TARGET_COVERED: ${covered}`);
}

export const user = {
  press: (element: TreeNode) => act('tap', element),
  longPress: (element: TreeNode) => act('longPress', element),
  type: (element: TreeNode, text: string) => act('type', element, {text}),
  clear: (element: TreeNode) => act('type', element, {text: ''}),
  scroll: (element: TreeNode, offset: {x?: number; y?: number}) => act('scroll', element, offset),
  swipe: (element: TreeNode, options: {dx?: number; dy?: number; steps?: number; durationMs?: number}) => act('pan', element, options),
  async back() {
    const active = currentSession();
    await active.request({back: true});
    await active.refresh();
  },
};

function matcher(element: TreeNode, expected: unknown, actual: unknown, pass: boolean, description: string) {
  return {
    pass, actual, expected,
    message: () => `Expected ${element.testID ? '#' + element.testID : element.ref} ${description}\nReceived: ${JSON.stringify(actual)}\n${formatRender({root: element, viewport: element.box, source: 'shadowTree'}, {format: 'text'}).slice(0,1000)}`,
  };
}

expect.extend({
  toHaveTextContent(received: TreeNode, expected: TextMatch) {
    const node = resolveElement(received);
    const actual = textContent(node);
    const pass = typeof expected === 'string' ? (expected === '' ? normalizeText(actual) === '' : normalizeText(actual).includes(normalizeText(expected))) : matchesText(actual, expected);
    return matcher(node, expected, actual, pass, `to have text content ${String(expected)}`);
  },
  toHaveAccessibleName(received: TreeNode, expected?: TextMatch) {
    const node = resolveElement(received);
    return matcher(node, expected, node.name, expected === undefined ? !!node.name : matchesText(node.name, expected), `to have accessible name ${String(expected)}`);
  },
  toBeDisabled(received: TreeNode) {
    const node = resolveElement(received);
    const disabled = isElementDisabled(currentSession().tree, node);
    return matcher(node, true, disabled, disabled, 'to be disabled');
  },
  toBeChecked(received: TreeNode) {
    const node = resolveElement(received);
    const actual = node.a11y.state?.checked;
    return matcher(node, true, actual, ['checkbox', 'radio', 'switch'].includes(node.role ?? '') && actual === true, 'to be checked');
  },
  toBeSelected(received: TreeNode) {
    const node = resolveElement(received);
    return matcher(node, true, node.a11y.state?.selected, node.a11y.state?.selected === true, 'to be selected');
  },
  toBeVisible(received: TreeNode) {
    const node = resolveElement(received);
    const visible = isElementVisible(currentSession().tree, node);
    return matcher(node, true, visible, visible, 'to be visible');
  },
  toHaveTouchTarget(received: TreeNode, min = 44) {
    if (!Number.isFinite(min) || min <= 0) throw new Error('Touch target minimum must be positive');
    const node = resolveElement(received);
    const actual = {width: node.box.width, height: node.box.height};
    return matcher(node, `>= ${min} dp`, actual, actual.width >= min && actual.height >= min, `to have a touch target of at least ${min} dp`);
  },
});

declare module 'vitest' {
  interface Matchers<R, T> {
    toHaveTextContent(text: TextMatch): R;
    toHaveAccessibleName(name?: TextMatch): R;
    toBeDisabled(): R;
    toBeChecked(): R;
    toBeSelected(): R;
    toBeVisible(): R;
    toHaveTouchTarget(min?: number): R;
  }
}
