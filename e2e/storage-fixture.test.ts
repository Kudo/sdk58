import path from 'node:path';
import {expect, it} from 'vitest';
import {cli, E2E_PRESETS, get, hostSkip, ROOT} from './helpers.ts';

for (const preset of E2E_PRESETS) {
  it(`[${preset.name}] AsyncStorage real JS library reads/writes explicit native fixture, resetting each invocation`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const app = path.join(ROOT, 'examples/storage-fixture/App.tsx');
    const run = cli(['run', app, '--script', path.join(ROOT, 'examples/storage-fixture/actions.json')], preset);
    expect(run.status, run.stderr).toBe(0);
    const result = JSON.parse(run.stdout);
    expect(result.steps.every((step: {error?: unknown}) => !step.error)).toBe(true);
    expect(get(result.snapshots.saved, 'status').text).toBe('Saved');
    expect(get(result.snapshots.loaded, 'note').text).toBe('Remember this');
    expect(get(result.snapshots.removed, 'note').text ?? '').toBe('');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({code: 'APPLICATION_FIXTURE', target: 'turbo/RNCAsyncStorage'}));
    const savedAgain = cli(['run', app, '--script', '[{"type":{"testID":"note","text":"Persist only in this process"}},{"tap":{"testID":"save"}}]'], preset);
    expect(savedAgain.status, savedAgain.stderr).toBe(0);
    expect(get(JSON.parse(savedAgain.stdout).final, 'status').text).toBe('Saved');
    const fresh = cli(['run', app, '--script', '[{"tap":{"testID":"load"}}]'], preset);
    expect(fresh.status, fresh.stderr).toBe(0);
    expect(get(JSON.parse(fresh.stdout).final, 'note').text ?? '').toBe('');
  });
}
