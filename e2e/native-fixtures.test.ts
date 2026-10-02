import fs from 'node:fs';
import path from 'node:path';
import {expect, it} from 'vitest';
import {cli, E2E_PRESETS, hostSkip, ROOT} from './helpers.ts';
import type {Diagnostic} from '../packages/react-native-a11y-tree/src/diagnostics.ts';

for (const preset of E2E_PRESETS) {
  it(`[${preset.name}] explicit Expo/TurboModule fixtures support imports, actions, config and fresh edits`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const project = fs.mkdtempSync(path.join(ROOT, 'examples', '.native-fixtures-'));
    const external = fs.mkdtempSync(path.join(ROOT, 'examples', '.fixture-defs-'));
    try {
      fs.writeFileSync(path.join(project, 'package.json'), '{"name":"fixture-app","dependencies":{"expo":"58.0.0"}}');
      const app = path.join(project, 'App.tsx');
      const setup = path.join(external, "fixtures with 'quotes.js");
      fs.writeFileSync(app, `import React, {useState} from 'react';
        import {requireNativeModule} from 'expo';
        import {Text, Pressable, View, TurboModuleRegistry} from 'react-native';
        const permissions = requireNativeModule('ExamplePermissions');
        const storage = TurboModuleRegistry.getEnforcing('ExampleStorage');
        export default function App() {
          const [status, setStatus] = useState(permissions.getStatus());
          return <View><Text testID="status">{storage.read() + ':' + status}</Text>
            <Pressable testID="request" onPress={async () => setStatus(await permissions.requestAsync())}><Text>Request</Text></Pressable></View>;
        }`);
      const configure = (label: string) => fs.writeFileSync(setup, `export default {
        expoModules: {ExamplePermissions: {getStatus: () => 'denied', requestAsync: async () => 'granted'}},
        turboModules: {ExampleStorage: {read: () => '${label}'}}
      };`);
      configure('first');
      const missing = cli(['render', app, '--format', 'json'], preset);
      expect(missing.status, missing.stderr).toBe(4);
      expect(JSON.parse(missing.stdout).error.message).toContain('ExamplePermissions');
      const render = (extra: string[] = []) => cli(['render', app, '--format', 'compact', '--select', 'testID=status', '--setup', setup, ...extra], preset);
      const first = render();
      expect(first.status, first.stderr).toBe(0);
      const output = JSON.parse(first.stdout);
      expect(output.matches[0].text).toBe('first:denied');
      expect(output.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({code: 'APPLICATION_FIXTURE', target: 'expo/ExamplePermissions'}),
        expect.objectContaining({code: 'APPLICATION_FIXTURE', target: 'turbo/ExampleStorage'}),
      ]));
      const acted = cli(['run', app, '--setup', setup, '--script', '[{"tap":{"testID":"request"}}]', '--format', 'compact', '--select', 'testID=status'], preset);
      expect(acted.status, acted.stderr).toBe(0);
      expect(JSON.parse(acted.stdout).final[0].text).toBe('first:granted');
      configure('later');
      const edited = render();
      expect(edited.status, edited.stderr).toBe(0);
      expect(JSON.parse(edited.stdout).matches[0].text).toBe('later:denied');
      const config = path.join(project, 'a11y-tree.json');
      fs.writeFileSync(config, JSON.stringify({$schema: 'unused-schema.json', setup: path.relative(project, setup), failOnFallback: true}));
      expect(render().status).toBe(6);
      expect(render(['--no-fail-on-fallback']).status).toBe(0);
      const allowed = output.diagnostics.map((d: Diagnostic) => d.target);
      fs.writeFileSync(config, JSON.stringify({setup: path.relative(project, setup), failOnFallback: true, allowFallback: allowed}));
      const checked = cli(['check', app, '--rules', '{"rules":{}}'], preset);
      expect(checked.status, checked.stderr).toBe(0);
      expect(JSON.parse(checked.stdout).ok).toBe(true);
      const session = cli(['session', app, '--format', 'compact'], preset, '{"id":1,"quit":true}\n');
      expect(session.status, session.stderr).toBe(0);
      expect(JSON.parse(session.stdout.split('\n')[0]).diagnostics).toEqual(output.diagnostics);
      const bad = cli(['render', app, '--setup', path.join(external, 'missing.js'), '--format', 'json'], preset);
      expect(bad.status, bad.stderr).toBe(1);
      expect(JSON.parse(bad.stdout).error.code).toBe('USAGE');
    } finally {
      fs.rmSync(project, {recursive: true, force: true});
      fs.rmSync(external, {recursive: true, force: true});
    }
  });
}
