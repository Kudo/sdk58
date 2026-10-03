import path from 'node:path';
import {expect, it} from 'vitest';
import {cli, E2E_PRESETS, hostSkip, ROOT} from './helpers.ts';

for (const preset of E2E_PRESETS) {
  it(`[${preset.name}] type replaces text and expect controls exit status`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const app = path.join(ROOT, 'examples/basic/App.tsx');
    const passing = cli(['run', app, '--format', 'json', '--script', JSON.stringify([
      {type: {testID: 'email', text: 'old'}},
      {type: {testID: 'email', text: 'new'}},
      {expect: {testID: 'email', text: 'new'}},
      {expect: {testID: 'absent', exists: false}},
    ])], preset);
    expect(passing.status, passing.stderr).toBe(0);
    expect(JSON.parse(passing.stdout).steps.at(-2).assertion.actual).toBe('new');

    const failing = cli(['run', app, '--format', 'text', '--script', '[{"expect":{"testID":"email","text":"wrong"}}]'], preset);
    expect(failing.status).toBe(2);
    expect(failing.stdout).toContain('✗ #email text');
  });
}
