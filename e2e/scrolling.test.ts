import path from 'node:path';
import {describe, expect, it} from 'vitest';

import type {RunResult, TreeNode} from '../packages/react-native-a11y-tree/src/schema.ts';
import {cliJson, E2E_PRESETS, find, hostSkip, ROOT} from './helpers.ts';

const APP = path.join(ROOT, 'examples', 'scrolling', 'App.tsx');
const SCRIPT = path.join(ROOT, 'examples', 'scrolling', 'actions.json');

function refs(node: TreeNode): string[] {
  return [node.ref, ...node.children.flatMap(refs)];
}

describe('scrolling', () => {
  it.for(E2E_PRESETS)('[$name] run examples/scrolling/actions.json', {timeout: 180_000}, (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    const result = cliJson<RunResult>(['run', APP, '--script', SCRIPT], preset);
    for (const step of result.steps) {
      expect(step.error, `step ${step.index} failed: ${JSON.stringify(step.error)}`).toBe(undefined);
    }
    const {before, after} = result.snapshots;
    const flatAfter = result.snapshots['flat-after'];

    // onScroll received the offset.
    expect(find(after, 'offset')?.text).toBe('offset 600');

    // The ScrollView reports its scroll position, and its rows move up by it.
    expect(find(before, 'list')?.style.contentOffset).toStrictEqual({x: 0, y: 0});
    expect(find(after, 'list')?.style.contentOffset).toStrictEqual({x: 0, y: 600});
    expect(find(after, 'row-0')!.box.y).toBe(find(before, 'row-0')!.box.y - 600);

    // The tap at row-12's on-screen center lands inside row-12.
    const tap = result.steps.find(s => s.action === 'tap')!;
    expect(tap.target?.testID).toBe('row-12');
    expect(tap.warnings, `tap warnings: ${tap.warnings}`).toBe(undefined);
    expect(tap.hit?.ref != null && refs(find(after, 'row-12')!).includes(tap.hit.ref), `hit ${JSON.stringify(tap.hit)} is not inside row-12`).toBeTruthy();
    expect(find(result.snapshots['after-tap'], 'selected')?.text).toBe('row 12');

    // FlatList renders rows beyond the initial window after scrolling.
    expect(find(before, 'flat-row-50')).toBe(undefined);
    expect(find(flatAfter, 'flat-row-50'), 'flat-row-50 not rendered after scrolling').toBeTruthy();
  });
});
