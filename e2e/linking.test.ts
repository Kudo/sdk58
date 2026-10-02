import fs from 'node:fs';
import path from 'node:path';
import {expect, it} from 'vitest';
import {cli, e2ePreset, get, hostSkip, ROOT} from './helpers.ts';

it('[ios-phone] Linking rejects unsimulated native operations even when the app catches them', {timeout: 180_000}, t => {
  if (hostSkip) t.skip(hostSkip);
  const preset = e2ePreset(t, 'ios-phone');
  const dir = fs.mkdtempSync(path.join(ROOT, 'examples/.linking-'));
  try {
    const app = path.join(dir, 'App.tsx');
    fs.writeFileSync(app, `import React, {useState} from 'react';
import {Linking, Pressable, Text, View} from 'react-native';
export default function App() {
  const [status, setStatus] = useState('Ready');
  return <View><Text testID="status">{status}</Text><Pressable testID="open" onPress={async () => {
    const results = [];
    for (const method of ['openURL', 'openSettings', 'canOpenURL']) {
      try {await Linking[method]('https://example.invalid'); results.push('resolved');}
      catch {results.push('rejected');}
    }
    setStatus(results.join(','));
  }}><Text>Open</Text></Pressable></View>;
}`);
    const rendered = cli(['render', app], preset);
    expect(rendered.status, rendered.stderr).toBe(0);
    const allow = JSON.parse(rendered.stdout).diagnostics.flatMap((d: {target: string}) => ['--allow-fallback', d.target]);
    const script = '[{"tap":{"testID":"open"}}]';
    const result = cli(['run', app, '--script', script, '--no-stderr'], preset);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stderr).toBe('');
    const output = JSON.parse(result.stdout);
    expect(get(output.final, 'status').text).toBe('rejected,rejected,rejected');
    for (const method of ['openURL', 'openSettings', 'canOpenURL']) {
      expect(output.diagnostics).toContainEqual(expect.objectContaining({code: 'NATIVE_API_UNSUPPORTED', target: `LinkingManager.${method}`}));
    }
    const strict = cli(['run', app, '--script', script, '--format', 'json', '--fail-on-fallback', ...allow], preset);
    expect(strict.status, strict.stdout + strict.stderr).toBe(6);
    expect(JSON.parse(strict.stdout).error.code).toBe('UNSUPPORTED_NATIVE');
    const session = cli(['session', app, '--fail-on-fallback', ...allow], preset,
      '{"id":1,"action":{"tap":{"testID":"open"}}}\n{"id":2,"quit":true}\n');
    expect(session.status, session.stdout + session.stderr).toBe(6);
    const lines = session.stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(lines[0].ready).toBe(true);
    expect(lines[1]).toMatchObject({id: 1, ok: false, error: {code: 'UNSUPPORTED_NATIVE'}});
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});
