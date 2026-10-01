import path from 'node:path';
import {describe, expect, it} from 'vitest';

import type {RenderResult} from '../src/schema.ts';
import {cliJson, E2E_PRESETS, get, hostSkip, ROOT} from './helpers.ts';

const APP = path.join(ROOT, 'examples', 'unicode', 'App.tsx');

// Hermes' platform Unicode functions (CoreFoundation on macOS, ICU with the
// trimmed data of scripts/icu-data-filter.json on Linux). Hermes is built
// without Intl: locale and options arguments are ignored, the host's default
// locale (en_US_POSIX on Linux without LANG) and time zone are used.
describe('unicode', () => {
  it.for(E2E_PRESETS)('[$name] localeCompare, toLocaleDateString, case mapping, normalize (examples/unicode)', {timeout: 180_000}, (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    const result = cliJson<RenderResult>(['render', APP], preset);
    expect(get(result.root, 'locale-compare').text).toBe('localeCompare -1 1 0');
    // English medium date (en data), in the host's time zone.
    expect(get(result.root, 'date').text).toMatch(/^date (Dec 31, 1969|Jan 1, 1970)$/);
    expect(get(result.root, 'number').text).toMatch(/^number 1,?234\.5$/);
    // U+0130 lowercases to i + U+0307 (root case mapping).
    expect(get(result.root, 'lower').text).toBe('lower 69 307');
    expect(get(result.root, 'upper').text).toBe('upper SS');
    expect(get(result.root, 'nfd').text).toBe('nfd 2 nfc 1 nfkc fi');
  });
});
