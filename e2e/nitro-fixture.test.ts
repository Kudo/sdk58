import path from 'node:path';
import {expect, it} from 'vitest';
import type {Diagnostic} from '../packages/react-native-a11y-tree/src/diagnostics.ts';
import {cli, E2E_PRESETS, get, hostSkip, ROOT} from './helpers.ts';

const example = path.join(ROOT, 'examples/nitro-fixture');
const setup = path.join(example, 'fixtures.ts');
const app = path.join(example, 'App.tsx');
const view = path.join(example, 'View.tsx');
const allow = (names: string[]) => names.flatMap(name => ['--allow-fallback', name]);
const moduleTargets = ['nitro/MMKVFactory', 'nitro/MMKVPlatformContext'];
const viewTargets = ['nitro/ImageFactory', 'nitro/ImageLoaderFactory', 'nitro/ImageUtils', 'NitroImageView'];

for (const preset of E2E_PRESETS) {
  it(`[${preset.name}] real MMKV JS uses explicit Nitro factories for read/write/remove and starts fresh in another host`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    // Exercise automatic example config discovery, as the schema sweep does.
    const run = cli(['run', app, '--script', path.join(example, 'actions.json')], preset);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const result = JSON.parse(run.stdout);
    expect(result.steps.every((step: {error?: unknown}) => !step.error)).toBe(true);
    // This id comes from the fixture factory, not MMKV's automatic test mock.
    expect(get(result.final, 'storage-id').text).toBe('fixture-default-mmkv');
    expect(get(result.snapshots.saved, 'status').text).toBe('Saved');
    expect(get(result.snapshots.loaded, 'note').text).toBe('Nitro fixture note');
    expect(get(result.snapshots.deleted, 'status').text).toBe('Removed');
    expect(get(result.snapshots.removed, 'note').text ?? '').toBe('');
    expect(get(result.snapshots.removed, 'status').text).toBe('Loaded');
    for (const target of moduleTargets) expect(result.diagnostics).toContainEqual(expect.objectContaining({code: 'APPLICATION_FIXTURE', target}));
    const saved = cli(['run', app, '--setup', setup, '--script', '[{"type":{"testID":"note","text":"Only this process"}},{"tap":{"testID":"save"}}]'], preset);
    expect(saved.status, saved.stdout + saved.stderr).toBe(0);
    expect(get(JSON.parse(saved.stdout).final, 'status').text).toBe('Saved');
    const fresh = cli(['run', app, '--setup', setup, '--script', '[{"tap":{"testID":"load"}}]'], preset);
    expect(fresh.status, fresh.stdout + fresh.stderr).toBe(0);
    expect(get(JSON.parse(fresh.stdout).final, 'note').text ?? '').toBe('');
  });

  it(`[${preset.name}] real Nitro Image getHostComponent falls back honestly, preserving layout and interactive children`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const run = cli(['run', view, '--setup', setup, '--script', '[{"snapshot":"before"},{"tap":{"testID":"image-child"}}]'], preset);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const result = JSON.parse(run.stdout);
    expect(result.steps.every((step: {error?: unknown}) => !step.error)).toBe(true);
    const image = get(result.final, 'nitro-image');
    expect(image.box.width).toBe(160);
    expect(image.box.height).toBe(96);
    expect(get(result.snapshots.before, 'child-status').text).toBe('Child untouched');
    expect(get(result.final, 'child-status').text).toBe('Child pressed');
    expect(get(result.final, 'ref-status').text).toBe('No native hybrid ref');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({code: 'NATIVE_COMPONENT_FALLBACK', target: 'NitroImageView', message: expect.stringContaining('Native drawing, custom props and methods are not simulated')}));
    for (const target of viewTargets.filter(name => name.startsWith('nitro/'))) expect(result.diagnostics).toContainEqual(expect.objectContaining({code: 'APPLICATION_FIXTURE', target}));
  });

  for (const [label, file, targets] of [
    ['MMKV', app, moduleTargets],
    ['Nitro Image', view, viewTargets],
  ] as const) it(`[${preset.name}] ${label} fixtures require exact allowances and unsupported boxing still fails strict mode`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const strict = cli(['render', file, '--format', 'json', '--setup', setup, '--fail-on-fallback'], preset);
    expect(strict.status, strict.stdout + strict.stderr).toBe(6);
    expect(JSON.parse(strict.stdout).error.code).toBe('UNSUPPORTED_NATIVE');
    const wrong = cli(['render', file, '--format', 'json', '--setup', setup, '--fail-on-fallback', '--allow-fallback', 'nitro/*'], preset);
    expect(wrong.status, wrong.stdout + wrong.stderr).toBe(6);
    const accepted = cli(['render', file, '--format', 'json', '--setup', setup, '--fail-on-fallback', ...allow([...targets, 'NitroModules.box'])], preset);
    expect(accepted.status, accepted.stdout + accepted.stderr).toBe(6);
    // Nitro's index catches its failed worklets registration. The unsupported
    // boxing diagnostic must survive that catch and cannot be allowlisted.
    expect(JSON.parse(accepted.stdout).error.details.diagnostics.map((d: Diagnostic) => ({code: d.code, target: d.target}))).toEqual([
      {code: 'NATIVE_API_UNSUPPORTED', target: 'NitroModules.box'},
    ]);
  });

  it(`[${preset.name}] absent Nitro bootstrap and missing named factories fail with useful errors`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const absent = cli(['render', app, '--format', 'json', '--setup', path.join(example, 'empty-fixtures.ts')], preset);
    expect(absent.status, absent.stdout + absent.stderr).toBe(4);
    expect(absent.stdout + absent.stderr).toMatch(/NitroModules/);
    const missing = cli(['render', path.join(example, 'MissingObject.tsx'), '--format', 'json', '--setup', setup], preset);
    expect(missing.status, missing.stdout + missing.stderr).toBe(4);
    expect(missing.stdout + missing.stderr).toContain('UnconfiguredNitroObject');
    expect(missing.stdout + missing.stderr).toMatch(/fixture|setup/i);
  });
}
