import path from 'node:path';
import {describe, expect, it} from 'vitest';

import type {RenderResult} from '../packages/react-native-a11y-tree/src/schema.ts';
import {cliJson, E2E_PRESETS, get, hostCapabilities, hostSkip, skipUnsupported, ROOT} from './helpers.ts';

const APP = path.join(ROOT, 'examples', 'dimensions', 'App.tsx');

describe('dimensions', () => {
  it.for(E2E_PRESETS)('[$name] Dimensions and PixelRatio follow the preset (examples/dimensions)', {timeout: 180_000}, (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    if (!hostCapabilities(preset).includes('deviceMetrics')) {
      skipUnsupported(t, 'host lacks deviceMetrics (NativeFantom.setDeviceMetrics)');
    }
    const {width, height, scale, fontScale} = preset;
    const result = cliJson<RenderResult>(['render', APP], preset);
    expect(get(result.root, 'window').text).toBe(`window ${width}x${height} scale ${scale} fontScale ${fontScale}`);
    // Dimensions.get('screen') at import time: set before the app module loads.
    expect(get(result.root, 'screen').text).toBe(`screen ${width}x${height}`);
    expect(get(result.root, 'pixel-ratio').text).toBe(`pixelRatio ${scale} fontScale ${fontScale}`);

    // --scale / --font-scale override the preset.
    const custom = cliJson<RenderResult>(['render', APP, '--scale', '2', '--font-scale', '1.5'], preset);
    expect(get(custom.root, 'window').text).toBe(`window ${width}x${height} scale 2 fontScale 1.5`);
    expect(get(custom.root, 'pixel-ratio').text).toBe('pixelRatio 2 fontScale 1.5');
  });
});
