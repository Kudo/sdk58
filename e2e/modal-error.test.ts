import path from 'node:path';
import {expect, it} from 'vitest';
import {cli, E2E_PRESETS, hostSkip, ROOT} from './helpers.ts';

for (const preset of E2E_PRESETS) {
  it(`[${preset.name}] zero-size modal targets report an explicit step error`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const app = path.join(ROOT, 'examples/basic/Modal.tsx');
    const result = cli(['run', app, '--format', 'json', '--script', '[{"tap":{"testID":"modal-action"}}]'], preset);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).steps[0].error.code).toBe('TARGET_ZERO_SIZE');
  });
}
