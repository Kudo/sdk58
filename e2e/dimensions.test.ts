import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'vitest';

import type {RenderResult} from '../src/schema.ts';
import {cliJson, E2E_PRESETS, get, hostCapabilities, hostSkip, ROOT} from './helpers.ts';

const APP = path.join(ROOT, 'examples', 'dimensions', 'App.tsx');

for (const preset of E2E_PRESETS) {
  test(`[${preset.name}] Dimensions and PixelRatio follow the preset (examples/dimensions)`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    if (!hostCapabilities(preset).includes('deviceMetrics')) {
      t.skip('host lacks deviceMetrics (NativeFantom.setDeviceMetrics)');
    }
    const {width, height, scale, fontScale} = preset;
    const result = cliJson<RenderResult>(['render', APP], preset);
    assert.equal(get(result.root, 'window').text, `window ${width}x${height} scale ${scale} fontScale ${fontScale}`);
    // Dimensions.get('screen') at import time: set before the app module loads.
    assert.equal(get(result.root, 'screen').text, `screen ${width}x${height}`);
    assert.equal(get(result.root, 'pixel-ratio').text, `pixelRatio ${scale} fontScale ${fontScale}`);

    // --scale / --font-scale override the preset.
    const custom = cliJson<RenderResult>(['render', APP, '--scale', '2', '--font-scale', '1.5'], preset);
    assert.equal(get(custom.root, 'window').text, `window ${width}x${height} scale 2 fontScale 1.5`);
    assert.equal(get(custom.root, 'pixel-ratio').text, 'pixelRatio 2 fontScale 1.5');
  });
}
