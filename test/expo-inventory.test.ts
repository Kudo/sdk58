import fs from 'node:fs';
import {URL} from 'node:url';
import {expect, it} from 'vitest';
import {scanNativeViews, mergeNativeViews} from '../scripts/expo-view-inventory.ts';

it('finds multiline calls, renamed factories, namespace calls and static constants', () => {
  const calls = scanNativeViews('packages/demo/src/View.ios.tsx', `
    import {requireNativeView as nativeView} from 'expo';
    import * as Core from 'expo-modules-core';
    const MODULE = 'Demo';
    const VIEW = 'Panel';
    const A = nativeView<Props>(MODULE, VIEW);
    const B = Core.requireNativeViewManager(\n 'Demo',\n 'Other'\n);
    // requireNativeView('NotACall')
  `);
  expect(calls.map(c => [c.module, c.view])).toEqual([['Demo', 'Panel'], ['Demo', 'Other']]);
  expect(calls[0].platforms).toEqual(['ios']);
});

it('keeps dynamic call sites visible and ignores unrelated functions', () => {
  const calls = scanNativeViews('packages/demo/src/View.tsx', `
    import {requireNativeView} from 'expo';
    import {requireNativeView as unrelated} from './other';
    export const make = (name) => requireNativeView(name);
    unrelated('Ignored');
  `);
  expect(calls).toHaveLength(1);
  expect(calls[0].module).toBe(null);
  expect(calls[0].expression).toBe('requireNativeView(name)');
});

it('deduplicates platform wrappers but retains each source reference', () => {
  const source = `import {requireNativeView} from 'expo'; export default requireNativeView('Demo', 'Panel');`;
  const entries = mergeNativeViews([
    ...scanNativeViews('packages/demo/src/View.ios.tsx', source).map(c => ({...c, package: 'demo'})),
    ...scanNativeViews('packages/demo/src/View.android.tsx', source).map(c => ({...c, package: 'demo'})),
  ]);
  expect(entries).toHaveLength(1);
  expect(entries[0].platforms).toEqual(['android', 'ios']);
  expect(entries[0].callSites).toHaveLength(2);
});

it('expands local view factories and conditional native view names', () => {
  const calls = scanNativeViews('packages/demo/src/View.tsx', `
    import {requireNativeView} from 'expo';
    function create(name: string) { return requireNativeView('Demo', name); }
    export const A = create('Panel');
    export const B = create('Card');
    const video = Platform.OS === 'android' ? 'SurfaceVideoView' : 'VideoView';
    export const Video = requireNativeView('Video', video);
  `);
  expect(calls.map(c => c.view).sort()).toEqual(['Card', 'Panel', 'SurfaceVideoView', 'VideoView']);
});

it('the pinned inventory covers every shipped Expo UI view config', () => {
  const inventory = JSON.parse(fs.readFileSync(new URL('../docs/expo-native-views.json', import.meta.url), 'utf8'));
  const configs = JSON.parse(fs.readFileSync(new URL('../packages/react-native-a11y-tree/runtime/expo/viewConfigs.json', import.meta.url), 'utf8'));
  const names = inventory.views.filter((v: {package: string}) => v.package === '@expo/ui')
    .map((v: {module: string; view: string | null}) => v.module + (v.view ? '_' + v.view : '')).sort();
  expect(names).toEqual(Object.keys(configs.views).sort());
  expect(inventory.views.every((v: {callSites: unknown[]}) => v.callSites.length > 0)).toBe(true);
});
