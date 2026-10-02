import {expect, it} from 'vitest';
import {wrapNativeViewConfig} from '../packages/react-native-a11y-tree/runtime/nativeComponentFallback.ts';

it('uses View only for missing native components, without invoking their config loader', () => {
  const warnings: string[] = [];
  const view = {uiViewClassName: 'RCTView', validAttributes: {testID: true}};
  const get = wrapNativeViewConfig('MissingView', () => {throw new Error('no native config');}, {
    hasComponent: () => false, viewConfig: () => view, warn: message => warnings.push(message),
  });
  expect(get()).toEqual(view);
  expect(get()).toEqual(view);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('[NATIVE_COMPONENT_FALLBACK] MissingView');
});

it('preserves supported view configs and propagates their errors', () => {
  const deps = {hasComponent: () => true, viewConfig: () => ({}), warn: () => {throw new Error('unexpected warning');}};
  const original = {uiViewClassName: 'RCTText'};
  expect(wrapNativeViewConfig('RCTText', () => original, deps)()).toBe(original);
  expect(() => wrapNativeViewConfig('SupportedButBroken', () => {throw new Error('broken config');}, deps)()).toThrow('broken config');
});

it.each(['RNSTabsHostIOS', 'RNSTabsHostAndroid'])('reports descriptor-only %s semantics without replacing its registered config', name => {
  const warnings: string[] = [];
  const original = {uiViewClassName: name, validAttributes: {navStateRequest: true}};
  const get = wrapNativeViewConfig(name, () => original, {
    hasComponent: () => true, viewConfig: () => {throw new Error('must keep registered descriptor');}, warn: message => warnings.push(message),
  });
  expect(get()).toBe(original);
  expect(get()).toBe(original);
  expect(warnings).toEqual([expect.stringContaining(`[NATIVE_COMPONENT_FALLBACK] ${name}:`)]);
  expect(warnings[0]).toContain('selected-page visibility');
});
