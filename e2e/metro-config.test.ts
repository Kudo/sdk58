import fs from 'node:fs';
import path from 'node:path';
import {expect, it} from 'vitest';
import {cli, E2E_PRESETS, get, hostSkip, ROOT} from './helpers.ts';

for (const preset of E2E_PRESETS) {
  it(`[${preset.name}] consumes explicit app Metro configuration and real SVG transformer without stale config reuse`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const dir = fs.mkdtempSync(path.join(ROOT, 'examples/.metro-config-'));
    const app = path.join(dir, 'app');
    const shared = path.join(dir, 'shared');
    fs.mkdirSync(app); fs.mkdirSync(shared);
    try {
      fs.writeFileSync(path.join(app, 'package.json'), '{"name":"metro-app","private":true}');
      fs.writeFileSync(path.join(shared, 'package.json'), '{"name":"shared-component","private":true}');
      for (const name of ['react', 'react-native']) {
        const competing = path.join(shared, 'node_modules', name);
        fs.mkdirSync(competing, {recursive: true});
        fs.writeFileSync(path.join(competing, 'package.json'), JSON.stringify({name, version: '0.0.0', main: 'index.js'}));
        fs.writeFileSync(path.join(competing, 'index.js'), `throw new Error('Wrong shared-package ${name} copy');`);
      }
      fs.writeFileSync(path.join(shared, 'App.tsx'), `import React from 'react'; import {View,Text} from 'react-native'; import Logo from './logo.svg'; import caption from 'project-caption'; export default function App(){return <View><Text testID="caption">{caption}</Text><Logo testID="logo" width={80} height={40} /></View>;}`);
      fs.writeFileSync(path.join(shared, 'Plain.tsx'), `import React from 'react'; import {Text} from 'react-native'; export default () => <Text>Plain</Text>;`);
      fs.writeFileSync(path.join(shared, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><path d="M0 0h80v40H0z" fill="red"/></svg>');
      fs.writeFileSync(path.join(app, 'one.js'), 'export default "First app configuration";');
      fs.writeFileSync(path.join(app, 'two.js'), 'export default "Edited app configuration";');
      const helper = path.join(app, 'selection.cjs');
      fs.writeFileSync(helper, 'module.exports = "one.js";');
      const config = path.join(app, 'metro.config.cjs');
      fs.writeFileSync(config, `const path = require('node:path'); const {getDefaultConfig} = require('expo/metro-config'); const config = getDefaultConfig(__dirname); const selected = require('./selection.cjs'); config.resolver.assetExts = config.resolver.assetExts.filter(x => x !== 'svg'); config.resolver.sourceExts.push('svg'); config.transformer.babelTransformerPath = require.resolve('react-native-svg-transformer/expo'); config.resolver.resolveRequest = (context,name,platform) => name === 'project-caption' ? {type:'sourceFile',filePath:path.join(__dirname,selected)} : context.resolveRequest(context,name,platform); module.exports = config;`);
      const ignored = cli(['render', path.join(shared, 'Plain.tsx'), '--project-root', app], preset);
      expect(ignored.status, ignored.stderr).toBe(0);
      expect(JSON.parse(ignored.stdout).diagnostics).toContainEqual(expect.objectContaining({code: 'BUILD_CONFIGURATION', target: 'metro-config'}));
      const args = ['render', path.join(shared, 'App.tsx'), '--project-root', app, '--metro-config', config, '--timing'];
      const first = cli(args, preset);
      expect(first.status, first.stdout + first.stderr).toBe(0);
      expect(get(JSON.parse(first.stdout).root, 'caption').text).toBe('First app configuration');
      expect(get(JSON.parse(first.stdout).root, 'logo').box).toMatchObject({width: 80, height: 40});
      expect(first.stderr).toContain('"bundleCache":"off"');
      // Only a config helper changes; neither the component nor its imported files change.
      fs.writeFileSync(helper, 'module.exports = "two.js";');
      fs.writeFileSync(path.join(app, 'a11y-tree.json'), JSON.stringify({metroConfig: './metro.config.cjs'}));
      const edited = cli(['render', path.join(shared, 'App.tsx'), '--project-root', app, '--timing'], preset);
      expect(edited.status, edited.stdout + edited.stderr).toBe(0);
      expect(get(JSON.parse(edited.stdout).root, 'caption').text).toBe('Edited app configuration');
      expect(edited.stderr).toContain('"bundleCache":"off"');
      fs.writeFileSync(config, "module.exports = {transformerPath: require.resolve('react-native-svg-transformer/expo')};");
      const unsupported = cli(args, preset);
      expect(unsupported.status, unsupported.stdout + unsupported.stderr).toBe(1);
      expect(unsupported.stderr + unsupported.stdout).toMatch(/transformerPath|worker/);
    } finally {fs.rmSync(dir, {recursive: true, force: true});}
  });
}
