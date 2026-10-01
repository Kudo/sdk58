import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';

import type {RenderResult} from '../src/schema.ts';
import {cliJson, E2E_PRESETS, e2ePreset, findAll, get, hostSkip, ROOT} from './helpers.ts';

const APP = path.join(ROOT, 'examples', 'unicode', 'App.tsx');

// Hermes' platform Unicode functions (CoreFoundation on macOS, ICU with the
// trimmed data of scripts/icu-data-filter.json elsewhere). Hermes is built
// without Intl: locale and options arguments are ignored; the host's default
// locale (en_US off Apple, src/platform/icu/IcuDefaultLocale.cpp) and the
// host's time zone (TZ=UTC from the CLI unless --tz) are used. Medium date +
// time: "<date> at <time>" (CoreFoundation) or "<date>, <time>" (ICU), the
// time with U+202F before AM/PM.
describe('unicode', () => {
  it.for(E2E_PRESETS)('[$name] localeCompare, toLocaleDateString, case mapping, normalize (examples/unicode)', {timeout: 180_000}, (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    const result = cliJson<RenderResult>(['render', APP], preset);
    expect(get(result.root, 'locale-compare').text).toBe('localeCompare -1 1 0');
    // English medium date (en data), in UTC (the CLI's default TZ).
    expect(get(result.root, 'date').text).toBe('date Jan 1, 1970');
    expect(get(result.root, 'time').text).toBe('time 12:00:00\u202fAM');
    expect(get(result.root, 'datetime').text).toMatch(/^datetime Jan 1, 1970(,| at) 12:00:00\u202fAM$/);
    expect(get(result.root, 'number').text).toMatch(/^number 1,?234\.5$/);
    // U+0130 lowercases to i + U+0307 (root case mapping).
    expect(get(result.root, 'lower').text).toBe('lower 69 307');
    expect(get(result.root, 'upper').text).toBe('upper SS');
    expect(get(result.root, 'nfd').text).toBe('nfd 2 nfc 1 nfkc fi');
  });

  // The machine's time zone does not change the output; --tz does. JST-9 is a
  // POSIX TZ (no tzdata needed in old images) without DST.
  it('[android-phone] the host runs in UTC whatever the machine TZ is; --tz JST-9 shifts by 9 h', {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const preset = e2ePreset(t, 'android-phone');
    const time = (args: string[]) => get(cliJson<RenderResult>(['render', APP, ...args], preset).root, 'time').text;
    try {
      vi.stubEnv('TZ', 'America/Los_Angeles');
      expect(time([])).toBe('time 12:00:00\u202fAM');
      expect(time(['--tz', 'JST-9'])).toBe('time 9:00:00\u202fAM');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // The machine's locale does not change the output (ICU's default locale is
  // fixed; CoreFoundation does not read LANG).
  it('[android-phone] LANG=de_DE.UTF-8 renders the same strings as no LANG', {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const preset = e2ePreset(t, 'android-phone');
    const texts = () => findAll(cliJson<RenderResult>(['render', APP], preset).root, n => n.type === 'Paragraph').map(n => n.text);
    try {
      for (const name of ['LANG', 'LC_ALL', 'LC_MESSAGES']) vi.stubEnv(name, undefined);
      const unsetTexts = texts();
      vi.stubEnv('LANG', 'de_DE.UTF-8');
      vi.stubEnv('LC_ALL', 'de_DE.UTF-8');
      expect(texts()).toStrictEqual(unsetTexts);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
