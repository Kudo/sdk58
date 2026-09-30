import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'vitest';

import type {RunResult, TreeNode} from '../src/schema.ts';
import {cliJson, E2E_PRESETS, find, hostSkip, ROOT} from './helpers.ts';

const APP = path.join(ROOT, 'examples', 'scrolling', 'App.tsx');
const SCRIPT = path.join(ROOT, 'examples', 'scrolling', 'actions.json');

function refs(node: TreeNode): string[] {
  return [node.ref, ...node.children.flatMap(refs)];
}

for (const preset of E2E_PRESETS) {
  test(`[${preset.name}] run examples/scrolling/actions.json`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const result = cliJson<RunResult>(['run', APP, '--script', SCRIPT], preset);
    for (const step of result.steps) {
      assert.equal(step.error, undefined, `step ${step.index} failed: ${JSON.stringify(step.error)}`);
    }
    const {before, after} = result.snapshots;
    const flatAfter = result.snapshots['flat-after'];

    // onScroll received the offset.
    assert.equal(find(after, 'offset')?.text, 'offset 600');

    // The ScrollView reports its scroll position, and its rows move up by it.
    assert.deepEqual(find(before, 'list')?.style.contentOffset, {x: 0, y: 0});
    assert.deepEqual(find(after, 'list')?.style.contentOffset, {x: 0, y: 600});
    assert.equal(find(after, 'row-0')!.box.y, find(before, 'row-0')!.box.y - 600);

    // The tap at row-12's on-screen center lands inside row-12.
    const tap = result.steps.find(s => s.action === 'tap')!;
    assert.equal(tap.target?.testID, 'row-12');
    assert.equal(tap.warnings, undefined, `tap warnings: ${tap.warnings}`);
    assert.ok(
      tap.hit?.ref != null && refs(find(after, 'row-12')!).includes(tap.hit.ref),
      `hit ${JSON.stringify(tap.hit)} is not inside row-12`,
    );
    assert.equal(find(result.snapshots['after-tap'], 'selected')?.text, 'row 12');

    // FlatList renders rows beyond the initial window after scrolling.
    assert.equal(find(before, 'flat-row-50'), undefined);
    assert.ok(find(flatAfter, 'flat-row-50'), 'flat-row-50 not rendered after scrolling');
  });
}
