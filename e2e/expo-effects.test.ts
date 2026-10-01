import path from 'node:path';
import {expect, it} from 'vitest';
import type {RunResult} from '../packages/react-native-a11y-tree/src/schema.ts';
import {cliJson, E2E_PRESETS, findAll, get, hostSkip, ROOT} from './helpers.ts';

for (const preset of E2E_PRESETS) {
  it(`[${preset.name}] Expo effects preserve layout, accessibility, props and child interaction`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const result = cliJson<RunResult>(['run', path.join(ROOT, 'examples/expo-effects/App.tsx'), '--script', path.join(ROOT, 'examples/expo-effects/actions.json')], preset);
    const tree = result.final;
    expect(get(tree, 'availability').text).toBe(preset.platform === 'ios' ? 'true/true' : 'false/false');
    expect(get(tree, 'glass-button').role).toBe('button');
    expect(get(tree, 'glass-button').name).toBe('Pressed through glass');
    for (const [id, width, height] of [['glass-container', 240, 80], ['glass', 200, 64], ['blur-target', 240, 64], ['blur', 240, 64], ['gradient', 240, 64]] as const) {
      expect(get(tree, id).box).toMatchObject({width, height});
    }
    expect(findAll(tree, n => n.text === 'Blur target child')).toHaveLength(1);
    expect(findAll(tree, n => n.text === 'Blur child')).toHaveLength(1);
    expect(findAll(tree, n => n.text === 'Gradient child')).toHaveLength(1);
    const blur = findAll(tree, n => n.type === 'Expo.ExpoBlur_ExpoBlurView')[0];
    expect(blur.expo).toMatchObject({intensity: 40, tint: 'dark'});
    const gradient = findAll(tree, n => n.type === 'Expo.ExpoLinearGradient')[0];
    expect(gradient.expo?.colors).toHaveLength(2);
    if (preset.platform === 'ios') {
      expect(get(tree, 'glass').type).toBe('Expo.ExpoGlassEffect_GlassView');
      expect(get(tree, 'glass').expo).toMatchObject({glassEffectStyle: 'regular', tintColor: '#abcdef', isInteractive: true, colorScheme: 'dark'});
      expect(get(tree, 'glass-container').expo).toMatchObject({spacing: 12});
    }
  });
}
