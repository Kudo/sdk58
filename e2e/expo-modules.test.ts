import path from 'node:path';
import {expect, it} from 'vitest';
import type {RunResult} from '../packages/react-native-a11y-tree/src/schema.ts';
import {cli, E2E_PRESETS, get, hostSkip, ROOT} from './helpers.ts';

for (const preset of E2E_PRESETS) {
  it(`[${preset.name}] image adapter preserves layout/accessibility, optional absence, and API failures`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const result = cli(['run', path.join(ROOT, 'examples/expo-modules/App.tsx'), '--quiet', '--script', '[{"tap":{"testID":"load-image"}}]'], preset);
    expect(result.status, result.stderr).toBe(0);
    const {final: tree, logs} = JSON.parse(result.stdout) as RunResult;
    expect(get(tree, 'image')).toMatchObject({role: 'image', name: 'Expo logo', box: {width: 120, height: 80}});
    expect(get(tree, 'image').expo).toMatchObject({contentFit: 'contain', source: [expect.objectContaining({width: expect.any(Number), height: expect.any(Number)})]});
    expect(get(tree, 'optional').text).toBe('Optional module unavailable');
    expect(JSON.parse(get(tree, 'insets').text!)).toEqual(preset.safeAreaInsets);
    expect(get(tree, 'result').text).toContain('[NATIVE_API_UNSUPPORTED] ExpoImage.loadAsync');
    expect(result.stderr.match(/\[NATIVE_MODULE_FALLBACK\] ExpoImage\b/g)).toHaveLength(1);
    expect(logs?.some(log => log.message.startsWith('[NATIVE_MODULE_FALLBACK] ExpoImage'))).toBe(true);
  });
  it(`[${preset.name}] unknown required modules fail with an actionable hint`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const result = cli(['render', path.join(ROOT, 'examples/expo-modules/Required.tsx'), '--format', 'json'], preset);
    expect(result.status, result.stderr).toBe(4);
    const {error} = JSON.parse(result.stdout);
    expect(error.code).toBe('APP_THREW');
    expect(error.message).toContain('ExampleUnavailableRequiredModule');
    expect(error.hint).toContain('expoModules.ExampleUnavailableRequiredModule');
    expect(error.hint).toContain('--setup');
  });
}

it('session emits adapter warnings on stderr even when quiet', {timeout: 180_000}, t => {
  if (hostSkip) t.skip(hostSkip);
  const result = cli(['session', path.join(ROOT, 'examples/expo-modules/App.tsx'), '--quiet'], E2E_PRESETS[0], '{"id":1,"quit":true}\n');
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim().split('\n').map(line => JSON.parse(line))[0].ready).toBe(true);
  expect(result.stderr.match(/\[NATIVE_MODULE_FALLBACK\] ExpoImage\b/g)).toHaveLength(1);
});
