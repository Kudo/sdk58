import {expect, it} from 'vitest';
import {collectDiagnostics, fidelityError} from '../packages/react-native-a11y-tree/src/diagnostics.ts';
import {formatRender} from '../packages/react-native-a11y-tree/src/format.ts';
import {toRenderResult} from '../packages/react-native-a11y-tree/src/tree.ts';

it('deduplicates observed limitations without treating ordinary logs as fallbacks', () => {
  const logs = [
    {level: 'warn', message: '[NATIVE_MODULE_FALLBACK] ExpoImage: layout only'},
    {level: 'warn', message: '[NATIVE_COMPONENT_FALLBACK] RNSVGPath is unsupported; using View.'},
    {level: 'warn', message: '[NATIVE_API_UNSUPPORTED] ExpoImage.loadAsync is not simulated.'},
    {level: 'warn', message: 'ordinary app warning'},
  ];
  const diagnostics = collectDiagnostics([...logs, logs[0]], ['events: js', 'events: js']);
  expect(diagnostics.map(d => [d.code, d.target])).toEqual([
    ['NATIVE_MODULE_FALLBACK', 'ExpoImage'],
    ['NATIVE_COMPONENT_FALLBACK', 'RNSVGPath'],
    ['NATIVE_API_UNSUPPORTED', 'ExpoImage.loadAsync'],
    ['RUNTIME_FALLBACK', 'events: js'],
  ]);
  expect(fidelityError(diagnostics, {})).toBeUndefined();
  const error = fidelityError(diagnostics, {failOnFallback: true, allowFallback: ['ExpoImage', 'RNSVGPath', 'events: js']});
  expect(error?.code).toBe('UNSUPPORTED_NATIVE');
  expect(error?.details?.diagnostics).toEqual([diagnostics[2]]);
  // An allowance for a module never licenses unsupported API calls.
  expect(fidelityError([diagnostics[2]], {failOnFallback: true, allowFallback: ['ExpoImage.loadAsync']})).toBeDefined();
  expect(fidelityError([diagnostics[0]], {failOnFallback: true, allowFallback: ['ExpoImage']})).toBeUndefined();
  expect(fidelityError([diagnostics[0]], {failOnFallback: true, allowFallback: ['Expo*']})).toBeDefined();
});

it('retains diagnostics when output is compact or filtered to zero nodes', () => {
  const result = toRenderResult({source: 'shadowTree', viewport: {width: 100, height: 100}, tree: {type: 'RootView', children: []}});
  result.diagnostics = collectDiagnostics([{level: 'warn', message: '[NATIVE_MODULE_FALLBACK] ExpoImage: layout only'}]);
  for (const format of ['json', 'compact'] as const) {
    const output = JSON.parse(formatRender(result, {format, select: ['testID=absent']}));
    expect(output.matches).toEqual([]);
    expect(output.diagnostics).toEqual(result.diagnostics);
  }
});
