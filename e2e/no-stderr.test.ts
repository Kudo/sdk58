import path from 'node:path';
import {expect, it} from 'vitest';
import {cli, E2E_PRESETS, hostSkip, ROOT} from './helpers.ts';

for (const preset of E2E_PRESETS) {
  it(`[${preset.name}] no-stderr preserves real fallback diagnostics and strict exits for renders, runs, checks and sessions`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const app = path.join(ROOT, 'examples/svg/Legacy.tsx');
    const diagnostic = expect.objectContaining({code: 'NATIVE_COMPONENT_FALLBACK', target: 'ExampleUnavailableView'});
    const baseline = cli(['render', app, '--quiet'], preset);
    expect(baseline.status, baseline.stderr).toBe(0);
    expect(baseline.stderr).toContain('NATIVE_COMPONENT_FALLBACK');
    for (const command of ['render', 'run', 'check']) {
      const extra = command === 'run' ? ['--script', '[]'] : command === 'check' ? ['--rules', '{"rules":{}}'] : [];
      const result = cli([command, app, ...extra, '--format', 'json', '--verbose', '--timing', '--no-stderr'], preset);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout).diagnostics).toContainEqual(diagnostic);
    }
    const ndjson = cli(['render', app, '--format', 'ndjson', '--no-stderr'], preset);
    expect(ndjson.status, ndjson.stdout + ndjson.stderr).toBe(0);
    expect(ndjson.stderr).toBe('');
    expect(ndjson.stdout.trim().split('\n').map(line => JSON.parse(line)).flatMap(line => line.diagnostics ?? [])).toContainEqual(diagnostic);
    const strict = cli(['render', app, '--format', 'ndjson', '--fail-on-fallback', '--no-stderr'], preset);
    expect(strict.status, strict.stdout + strict.stderr).toBe(6);
    expect(strict.stderr).toBe('');
    expect(strict.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(strict.stdout).error.details.diagnostics).toContainEqual(diagnostic);
    const session = cli(['session', app, '--verbose', '--timing', '--no-stderr'], preset, '{"id":1,"quit":true}\n');
    expect(session.status, session.stdout + session.stderr).toBe(0);
    expect(session.stderr).toBe('');
    expect(JSON.parse(session.stdout.split('\n')[0]).diagnostics).toContainEqual(diagnostic);
  });
}
