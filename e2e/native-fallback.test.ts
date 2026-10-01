import path from 'node:path';
import {expect, it} from 'vitest';
import type {RenderResult} from '../packages/react-native-a11y-tree/src/schema.ts';
import {cli, E2E_PRESETS, get, hostSkip, ROOT} from './helpers.ts';

for (const preset of E2E_PRESETS) {
  it(`[${preset.name}] react-native-svg falls back to View and warns once per rendered native type`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const result = cli(['render', path.join(ROOT, 'examples/svg/App.tsx')], preset);
    expect(result.status, result.stderr).toBe(0);
    const tree = (JSON.parse(result.stdout) as RenderResult).root;
    expect(get(tree, 'drawing')).toMatchObject({type: 'View', role: 'image', name: 'Demo drawing', box: {width: 120, height: 80}});
    expect(get(tree, 'shapes').type).toBe('View');
    expect(get(tree, 'circle').type).toBe('View');
    expect(get(tree, 'rectangle').type).toBe('View');
    expect(get(tree, 'before').text).toBe('Before SVG');
    expect(get(tree, 'after').text).toBe('After SVG');
    expect(result.stderr).toContain('[NATIVE_COMPONENT_FALLBACK] RNSVG');
    expect(result.stderr.match(/\[NATIVE_COMPONENT_FALLBACK\] RNSVGCircle\b/g)).toHaveLength(1);
    expect(result.stderr).not.toContain('[NATIVE_COMPONENT_FALLBACK] RCTView');
  });
}

for (const preset of E2E_PRESETS) {
  it(`[${preset.name}] legacy requireNativeComponent without a view config retains interactive children`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const result = cli(['run', path.join(ROOT, 'examples/svg/Legacy.tsx'), '--script', '[{"tap":{"testID":"child-button"}}]'], preset);
    expect(result.status, result.stderr).toBe(0);
    const tree = JSON.parse(result.stdout).final;
    expect(get(tree, 'legacy')).toMatchObject({type: 'View', box: {width: 200, height: 80}});
    expect(get(tree, 'child-button').name).toBe('Child pressed');
    expect(result.stderr).toContain('[NATIVE_COMPONENT_FALLBACK] ExampleUnavailableView');
  });
}

it('session keeps JSON stdout clean and reports fallback warnings on stderr', {timeout: 180_000}, t => {
  if (hostSkip) t.skip(hostSkip);
  const preset = E2E_PRESETS[0];
  const result = cli(['session', path.join(ROOT, 'examples/svg/Legacy.tsx')], preset, '{"id":1,"quit":true}\n');
  expect(result.status, result.stderr).toBe(0);
  const lines = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  expect(lines[0].ready).toBe(true);
  expect(result.stderr.match(/\[NATIVE_COMPONENT_FALLBACK\] ExampleUnavailableView\b/g)).toHaveLength(1);
});
