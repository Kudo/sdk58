import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {expect, it} from 'vitest';
import {cli as runCLI, E2E_PRESETS, findAll, get, hostSkip, ROOT} from './helpers.ts';

function cli(...args: Parameters<typeof runCLI>) {
  // Expo intentionally leaves _ctx untransformed in NODE_ENV=test for its
  // Jest utilities. These subprocesses exercise the real production entry.
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { return runCLI(...args); }
  finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else process.env.NODE_ENV = previous;
  }
}

for (const preset of E2E_PRESETS) {
  it(`[${preset.name}] --router renders a route without a wrapper file`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const project = path.join(ROOT, 'examples/sdk58-default');
    const setup = preset.platform === 'android' ? ['--setup', path.join(project, 'router-fixtures.ts')] : [];
    const result = cli(['render', '--router', '--route', '/explore', '--project-root', project, '--format', 'json', ...setup], preset);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(findAll(JSON.parse(result.stdout).root, n => n.text === 'Explore')).not.toHaveLength(0);
  });
  it(`[${preset.name}] ignores unrelated app config despite a resolvable hoisted Router`, {timeout: 120_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const dir = fs.mkdtempSync(path.join(ROOT, 'examples/.not-router-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"plain-component","private":true}');
      expect(createRequire(path.join(dir, 'package.json')).resolve('expo-router/package.json')).toBeTruthy();
      fs.writeFileSync(path.join(dir, 'app.config.js'), "throw new Error('Unrelated Expo config must not execute');");
      const app = path.join(dir, 'Component.tsx');
      fs.writeFileSync(app, `import React from 'react'; import {Text} from 'react-native'; export default () => <Text testID="plain">Plain component</Text>;`);
      const result = cli(['render', app, '--format', 'json'], preset);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(get(JSON.parse(result.stdout).root, 'plain').text).toBe('Plain component');
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  });

  it(`[${preset.name}] unchanged starter layout boots and changes Router pathname with explicit native limitations`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const project = path.join(ROOT, 'examples/sdk58-default');
    const app = path.join(project, 'RouterApp.tsx');
    const setup = preset.platform === 'android' ? ['--setup', path.join(project, 'router-fixtures.ts')] : [];
    const result = cli(['run', app, ...setup, '--script', '[{"snapshot":"initial"},{"tap":{"testID":"router-explore"}},{"snapshot":"explore"},{"tap":{"testID":"router-home"}}]'], preset);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const run = JSON.parse(result.stdout);
    expect(run.steps.every((step: {error?: unknown}) => !step.error)).toBe(true);
    expect(get(run.snapshots.initial, 'router-pathname').text).toBe('/');
    expect(get(run.snapshots.explore, 'router-pathname').text).toBe('/explore');
    expect(get(run.final, 'router-pathname').text).toBe('/');
    expect(findAll(run.final, n => !!n.text?.includes('Welcome to'))).not.toHaveLength(0);
    expect(findAll(run.snapshots.explore, n => n.text === 'Explore')).not.toHaveLength(0);
    // Screen text alone cannot establish selected-tab visibility: both native
    // screens can be mounted. The descriptor/fallback must disclose that limit.
    expect(run.diagnostics).toContainEqual(expect.objectContaining({code: 'NATIVE_COMPONENT_FALLBACK', target: `RNSTabsHost${preset.platform === 'ios' ? 'IOS' : 'Android'}`}));
    expect(run.logs.filter((log: {level: string; known?: boolean}) => log.level === 'error' && !log.known)).toEqual([]);
    if (preset.platform === 'android') {
      expect(run.diagnostics).toContainEqual(expect.objectContaining({code: 'APPLICATION_FIXTURE', target: 'expo/ExpoRouter'}));
      const missing = cli(['render', app, '--format', 'json'], preset);
      expect(missing.status, missing.stdout + missing.stderr).toBe(4);
      expect(JSON.parse(missing.stdout).error.message).toContain("Cannot find native module 'ExpoRouter'");
    }
  });

  // Each scenario starts several fresh Metro/host processes. Keep independent
  // discovery and config-cache checks in separate timeout windows for Docker CI.
  for (const scenario of ['default roots and navigation', 'configured roots and cache invalidation']) {
    it(`[${preset.name}] Expo Router ${scenario}`, {timeout: 180_000}, t => {
      if (hostSkip) t.skip(hostSkip);
      const dir = fs.mkdtempSync(path.join(ROOT, 'examples/.router-discovery-'));
      try {
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name: 'router-discovery', private: true, main: 'expo-router/entry', dependencies: {expo: '58.0.0', 'expo-router': '~58.0.9'}}));
        const app = path.join(dir, 'Router.tsx');
        // Use upstream _ctx, not a hard-coded require.context that bypasses discovery.
        fs.writeFileSync(app, `import React from 'react'; import {ExpoRoot} from 'expo-router'; import {ctx} from 'expo-router/_ctx'; export default () => <ExpoRoot context={ctx} location="/" />;`);
        const route = (root: string, label: string) => {
          const folder = path.join(dir, root);
          fs.mkdirSync(folder, {recursive: true});
          fs.writeFileSync(path.join(folder, '_layout.tsx'), `import React from 'react'; import {Slot,usePathname} from 'expo-router'; import {View,Text} from 'react-native'; export default function Layout(){return <View style={{flex:1}}><Text testID="pathname">{usePathname()}</Text><Slot /></View>;}`);
          fs.writeFileSync(path.join(folder, 'index.tsx'), `import React from 'react'; import {Link} from 'expo-router'; import {View,Text,Pressable} from 'react-native'; export default () => <View><Text testID="route-source">${label}</Text><Link href="/second" asChild><Pressable testID="next"><Text>Next route</Text></Pressable></Link></View>;`);
          fs.writeFileSync(path.join(folder, 'second.tsx'), `import React from 'react'; import {Link} from 'expo-router'; import {View,Text,Pressable} from 'react-native'; export default () => <View><Text testID="second">Second route</Text><Link href="/" asChild><Pressable testID="home"><Text>Home route</Text></Pressable></Link></View>;`);
        };
        route('app', 'app fallback');
        // The entry lives outside the project: --project-root must determine its
        // routes, not the hoisted expo-router package's directory.
        const qualifiedEntry = createRequire(path.join(dir, 'package.json')).resolve('expo-router/build/qualified-entry');
        const linking = path.join(dir, 'linking-fixture.ts');
        fs.writeFileSync(linking, `export default {turboModules:{IntentAndroid:{getInitialURL:async()=> '/'}}};`);
        const setup = preset.platform === 'android' ? ['--setup', linking] : [];
        const args = ['render', qualifiedEntry, '--project-root', dir, ...setup, '--format', 'json', '--timing'];
        const check = (label: string) => {
          const result = cli(args, preset);
          expect(result.status, result.stdout + result.stderr).toBe(0);
          expect(get(JSON.parse(result.stdout).root, 'route-source').text).toBe(label);
          if (preset.platform === 'android') expect(JSON.parse(result.stdout).diagnostics).toContainEqual(expect.objectContaining({code: 'APPLICATION_FIXTURE', target: 'turbo/IntentAndroid'}));
          return result;
        };
        if (scenario === 'default roots and navigation') {
          check('app fallback');
          route('src/app', 'src/app preferred');
          check('src/app preferred');
          const run = cli(['run', app, '--project-root', dir, '--script', '[{"tap":{"testID":"next"}},{"snapshot":"second"},{"tap":{"testID":"home"}}]'], preset);
          expect(run.status, run.stdout + run.stderr).toBe(0);
          const navigation = JSON.parse(run.stdout);
          expect(navigation.steps.every((step: {error?: unknown}) => !step.error)).toBe(true);
          expect(get(navigation.snapshots.second, 'pathname').text).toBe('/second');
          expect(get(navigation.snapshots.second, 'second').text).toBe('Second route');
          expect(findAll(navigation.snapshots.second, n => n.testID === 'route-source')).toHaveLength(0);
          expect(get(navigation.final, 'pathname').text).toBe('/');
        } else {
          route('src/app', 'src/app preferred');
          route('custom-one', 'first custom root');
          route('custom-two', 'edited helper root');
          const helper = path.join(dir, 'selected-root.cjs');
          fs.writeFileSync(helper, "module.exports = './custom-one';");
          fs.writeFileSync(path.join(dir, 'app.config.js'), `module.exports = {expo: {name:'Router audit',slug:'router-audit',plugins:[['expo-router',{root:require('./selected-root.cjs')}]]}};`);
          check('first custom root');
          expect(check('first custom root').stderr).toContain('"bundleCache":"hit"');
          // Only a config dependency changes, not the config or entry itself.
          fs.writeFileSync(helper, "module.exports = './custom-two';");
          expect(check('edited helper root').stderr).toContain('"bundleCache":"miss"');
          fs.writeFileSync(helper, "module.exports = '../outside-project';");
          const invalid = cli(args, preset);
          expect(invalid.status, invalid.stdout + invalid.stderr).toBe(1);
          expect(invalid.stdout + invalid.stderr).toMatch(/outside the project root/);
        }
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    });
  }
}
