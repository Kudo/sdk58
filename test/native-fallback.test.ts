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
