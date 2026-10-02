import path from 'node:path';
import {expect, it} from 'vitest';
import type {Diagnostic} from '../packages/react-native-a11y-tree/src/diagnostics.ts';
import {cli, E2E_PRESETS, hostSkip, ROOT} from './helpers.ts';

for (const preset of E2E_PRESETS) {
  it(`[${preset.name}] native fallback diagnostics survive filtering and can gate CI`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const app = path.join(ROOT, 'examples/svg/Legacy.tsx');
    const result = cli(['render', app, '--format', 'compact', '--select', 'testID=absent', '--quiet'], preset);
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.matches).toEqual([]);
    expect(output.diagnostics).toContainEqual(expect.objectContaining({code: 'NATIVE_COMPONENT_FALLBACK', target: 'ExampleUnavailableView'}));
    const strict = cli(['render', app, '--format', 'json', '--fail-on-fallback'], preset);
    expect(strict.status, strict.stderr).toBe(6);
    expect(JSON.parse(strict.stdout).error.code).toBe('UNSUPPORTED_NATIVE');
    const allow = output.diagnostics.flatMap((d: Diagnostic) => ['--allow-fallback', d.target]);
    const allowed = cli(['render', app, '--format', 'compact', '--fail-on-fallback', ...allow], preset);
    expect(allowed.status, allowed.stderr).toBe(0);
    expect(JSON.parse(allowed.stdout).diagnostics).toEqual(output.diagnostics);
    const checked = cli(['check', app, '--rules', '{"rules":{}}', '--format', 'json', '--fail-on-fallback'], preset);
    expect(checked.status, checked.stderr).toBe(6);
    expect(JSON.parse(checked.stdout).error.code).toBe('UNSUPPORTED_NATIVE');
  });

  it(`[${preset.name}] caught unsupported APIs reject strict runs and sessions after allowed imports`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const app = path.join(ROOT, 'examples/expo-modules/App.tsx');
    const rendered = cli(['render', app], preset);
    expect(rendered.status, rendered.stderr).toBe(0);
    const allow = JSON.parse(rendered.stdout).diagnostics.flatMap((d: Diagnostic) => ['--allow-fallback', d.target]);
    const script = '[{"tap":{"testID":"load-image"}}]';
    const permissive = cli(['run', app, '--script', script, '--format', 'compact'], preset);
    expect(permissive.status, permissive.stderr).toBe(0);
    expect(JSON.parse(permissive.stdout).diagnostics).toContainEqual(expect.objectContaining({code: 'NATIVE_API_UNSUPPORTED', target: 'ExpoImage.loadAsync'}));
    const strict = cli(['run', app, '--script', script, '--format', 'json', '--fail-on-fallback', ...allow], preset);
    expect(strict.status, strict.stderr).toBe(6);
    expect(JSON.parse(strict.stdout).error.details.diagnostics).toContainEqual(expect.objectContaining({code: 'NATIVE_API_UNSUPPORTED'}));
    const session = cli(['session', app, '--fail-on-fallback', ...allow], preset,
      '{"id":1,"action":{"tap":{"testID":"load-image"}}}\n{"id":2,"tree":true}\n');
    expect(session.status, session.stderr).toBe(6);
    const lines = session.stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0].ready).toBe(true);
    expect(lines[1]).toMatchObject({id: 1, ok: false, error: {code: 'UNSUPPORTED_NATIVE'}});
    expect(lines[1].diagnostics).toContainEqual(expect.objectContaining({target: 'ExpoImage'}));
    const refused = cli(['session', app, '--fail-on-fallback'], preset, '{"id":1,"quit":true}\n');
    expect(refused.status, refused.stderr).toBe(6);
    expect(JSON.parse(refused.stdout)).toMatchObject({ready: false, error: {code: 'UNSUPPORTED_NATIVE'}});
  });
}
