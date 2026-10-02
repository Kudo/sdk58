import fs from 'node:fs';
import path from 'node:path';
import {expect, it} from 'vitest';
import {cli, E2E_PRESETS, hostSkip, ROOT} from './helpers.ts';

it('fresh CLI invocations rebuild transformed code after Babel configuration changes', {timeout: 180_000}, t => {
  if (hostSkip) t.skip(hostSkip);
  const project = fs.mkdtempSync(path.join(ROOT, 'examples', '.build-cache-'));
  try {
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({name: 'cache-regression', dependencies: {expo: '58.0.0'}}));
    const app = path.join(project, 'App.tsx');
    const config = path.join(project, 'babel.config.cjs');
    fs.writeFileSync(app, `import React from 'react'; import {Text} from 'react-native'; const label = 'BUILD_VALUE'; export default function App() {return <Text testID="status">{label}</Text>;}`);
    const configure = (value: string) => fs.writeFileSync(config, `module.exports = {presets: ['babel-preset-expo'], plugins: [function() {return {visitor: {StringLiteral(p) {if (p.node.value === 'BUILD_VALUE') p.node.value = '${value}';}}};}]};`);
    const render = () => {
      const proc = cli(['render', app, '--select', 'testID=status', '--format', 'compact', '--timing', '--bytecode', 'off'], E2E_PRESETS[0]);
      expect(proc.status, proc.stderr).toBe(0);
      const timing = JSON.parse(proc.stderr.split('\n').find(line => line.startsWith('rn-a11y-tree timing: '))!.slice('rn-a11y-tree timing: '.length));
      return {text: JSON.parse(proc.stdout).matches[0].text, cache: timing.bundleCache};
    };
    configure('first');
    expect(render()).toEqual({text: 'first', cache: 'miss'});
    expect(render()).toEqual({text: 'first', cache: 'hit'});
    configure('other');
    expect(render()).toEqual({text: 'other', cache: 'miss'});
    expect(render()).toEqual({text: 'other', cache: 'hit'});
  } finally {
    fs.rmSync(project, {recursive: true, force: true});
  }
});
