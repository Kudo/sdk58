import fs from 'node:fs';
import path from 'node:path';
import {expect, it} from 'vitest';
import {cli, E2E_PRESETS, findAll, hostSkip, ROOT} from './helpers.ts';

for (const preset of E2E_PRESETS) {
  it(`[${preset.name}] uncaught React render errors fail initial render/run/check/session`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const dir = fs.mkdtempSync(path.join(ROOT, 'examples', '.render-errors-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"render-errors","dependencies":{"expo":"58.0.0"}}');
      const app = path.join(dir, 'App.tsx');
      fs.writeFileSync(app, `export default function App() {throw new Error('uncaught render sentinel');}`);
      for (const command of ['render', 'run', 'check']) {
        const args = command === 'run' ? ['--script', '[]'] : command === 'check' ? ['--rules', '{"rules":{}}'] : [];
        const result = cli([command, app, '--format', 'json', ...args], preset);
        expect(result.status, result.stdout + result.stderr).toBe(4);
        expect(JSON.parse(result.stdout).error).toMatchObject({code: 'APP_THREW', message: expect.stringContaining('uncaught render sentinel')});
      }
      const session = cli(['session', app], preset, '{"id":1,"quit":true}\n');
      expect(session.status, session.stdout + session.stderr).not.toBe(0);
      expect(JSON.parse(session.stdout.split('\n')[0])).toMatchObject({ready: false, error: {code: 'APP_THREW', message: expect.stringContaining('uncaught render sentinel')}});
    } finally {fs.rmSync(dir, {recursive: true, force: true});}
  });

  it(`[${preset.name}] React effect/non-Error failures surface, while error boundaries and console errors remain valid UI`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const dir = fs.mkdtempSync(path.join(ROOT, 'examples', '.render-errors-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"render-errors","dependencies":{"expo":"58.0.0"}}');
      const app = path.join(dir, 'App.tsx');
      for (const [source, expected] of [
        [`import {useEffect} from 'react'; export default function App() {useEffect(() => {throw new Error('effect sentinel')}, []); return null;}`, 'effect sentinel'],
        [`export default function App() {throw null;}`, 'Non-error value thrown: null'],
        [`export default function App() {throw Object.create(null);}`, 'Non-error value thrown'],
      ]) {
        fs.writeFileSync(app, source);
        const result = cli(['render', app, '--format', 'json'], preset);
        expect(result.status, result.stdout + result.stderr).toBe(4);
        expect(JSON.parse(result.stdout).error).toMatchObject({code: 'APP_THREW', message: expect.stringContaining(expected)});
      }
      fs.writeFileSync(app, `import React from 'react'; import {Text} from 'react-native';
        class Boundary extends React.Component {state = {failed: false}; static getDerivedStateFromError() {return {failed: true};}
          render() {return this.state.failed ? <Text testID="recovered">Handled fallback</Text> : this.props.children;}}
        function Broken() {throw new Error('handled boundary sentinel');}
        export default function App() {console.error('ordinary console error'); return <Boundary><Broken /></Boundary>;}`);
      const recovered = cli(['render', app, '--format', 'json'], preset);
      expect(recovered.status, recovered.stdout + recovered.stderr).toBe(0);
      const tree = JSON.parse(recovered.stdout).root;
      expect(findAll(tree, node => node.testID === 'recovered')[0].text).toBe('Handled fallback');
    } finally {fs.rmSync(dir, {recursive: true, force: true});}
  });
  it(`[${preset.name}] uncaught render failures after interaction appear in run steps and session responses`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const dir = fs.mkdtempSync(path.join(ROOT, 'examples', '.render-errors-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"render-errors","dependencies":{"expo":"58.0.0"}}');
      const app = path.join(dir, 'App.tsx');
      fs.writeFileSync(app, `import React, {useState} from 'react'; import {Pressable, Text} from 'react-native';
        export default function App() {const [failed, setFailed] = useState(false); if(failed) throw new Error('interaction render sentinel');
          return <Pressable testID="break" onPress={() => setFailed(true)}><Text>Trigger error</Text></Pressable>;}`);
      const run = cli(['run', app, '--script', '[{"tap":{"testID":"break"}}]', '--format', 'json'], preset);
      // The run protocol keeps step failures in the result, preserving its
      // documented exit behavior; a fatal React error must not be a clean step.
      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(JSON.parse(run.stdout).steps[0].error).toMatchObject({code: 'APP_THREW', message: expect.stringContaining('interaction render sentinel')});
      const session = cli(['session', app], preset, JSON.stringify({id: 1, action: {tap: {testID: 'break'}}}) + '\n' + JSON.stringify({id: 2, quit: true}) + '\n');
      const responses = session.stdout.trim().split('\n').map(line => JSON.parse(line));
      expect(responses[0].ready, session.stdout + session.stderr).toBe(true);
      expect(responses.find(line => line.id === 1)).toMatchObject({ok: false, error: {code: 'APP_THREW', message: expect.stringContaining('interaction render sentinel')}});
    } finally {fs.rmSync(dir, {recursive: true, force: true});}
  });

}
