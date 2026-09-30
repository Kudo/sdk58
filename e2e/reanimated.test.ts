import path from 'node:path';
import {describe, expect, it} from 'vitest';

import type {RunResult, TreeNode} from '../src/schema.ts';
import {cli, E2E_PRESETS, get, hostSkip, ROOT} from './helpers.ts';

const APP = path.join(ROOT, 'examples', 'reanimated', 'App.tsx');
const SCRIPT = path.join(ROOT, 'examples', 'reanimated', 'actions.json');

// Signs that the host has no worklets/reanimated native side. Today the app
// fails at import with "Cannot read property 'loadUnpackersWithCode' of
// undefined" in NativeWorklets/installUnpackers (globalThis.__workletsModuleProxy
// is not installed).
const NO_REANIMATED =
  /__workletsModuleProxy|WorkletsModule|ReanimatedModule|NativeWorklets|installUnpackers|loadUnpackersWith|Worklets|Reanimated/;

describe('reanimated', () => {
  it.for(E2E_PRESETS)('[$name] run examples/reanimated/actions.json', {timeout: 180_000}, (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    const proc = cli(['run', APP, '--script', SCRIPT], preset);
    if (proc.status !== 0) {
      if (NO_REANIMATED.test(proc.stderr)) {
        const first = proc.stderr.split('\n').find(l => l.startsWith('rn-a11y-tree:')) ?? '';
        t.skip(`host lacks reanimated support (${first.replace(/^rn-a11y-tree: /, '')})`);
      }
      expect.unreachable(`CLI failed:\n${proc.stderr}`);
    }
    const result = JSON.parse(proc.stdout) as RunResult;
    const stepErrors = result.steps.filter(s => s.error);
    const errorText = (e: unknown) => (typeof e === 'string' ? e : ((e as {message?: string})?.message ?? ''));
    if (stepErrors.some(s => NO_REANIMATED.test(errorText(s.error)))) {
      t.skip(`host lacks reanimated support (${errorText(stepErrors[0].error)})`);
    }
    expect(stepErrors).toStrictEqual([]);
    const s = result.snapshots;

    // withTiming(250, {duration: 400}) on width.
    expect(Math.abs(get(s.start, 'box').box.width - 50) <= 0.5).toBeTruthy();
    const midWidth = get(s.mid, 'box').box.width;
    expect(midWidth > 50 && midWidth < 250, `mid width ${midWidth}`).toBeTruthy();
    expect(Math.abs(get(s.end, 'box').box.width - 250) <= 0.5).toBeTruthy();

    // withSpring(120) on translateX. The layout box does not move; the
    // transform shows in visualBox.
    const slid = get(s.slid, 'slide');
    expect(slid.box.x).toBe(get(s.end, 'slide').box.x);
    if (slid.visualBox == null) expect.unreachable('slide has no visualBox after the spring');
    const dx = slid.visualBox.x - slid.box.x;
    expect(Math.abs(dx - 120) <= 1, `slide moved by ${dx}`).toBeTruthy();

    // FadeIn.duration(300) entering animation. It only changes the mounted
    // view, so this needs the host's mounted-view overrides in getA11yTree.
    const opacity = (node: TreeNode) => node.effectiveOpacity ?? 1;
    if (result.capabilities.includes('getA11yTree.mounted')) {
      expect(opacity(get(s['fade-start'], 'fade')) < 1, 'fade is fully opaque at fade-start').toBeTruthy();
    } else {
      t.annotate('fade-start opacity not checked: host lacks getA11yTree.mounted');
    }
    expect(opacity(get(s['fade-end'], 'fade'))).toBe(1);

    // runOnUI -> runOnJS roundtrip.
    expect(get(s.ui, 'label').text).toBe('from-ui');
  });
});
