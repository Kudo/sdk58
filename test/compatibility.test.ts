import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {inspectCompatibility, TESTED_DEPENDENCIES} from '../packages/react-native-a11y-tree/src/compatibility.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true}); });
function project(versions: Record<string, string> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-compatibility-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: 'app', dependencies: {'react': '0.0.0'}}));
  for (const [name, version] of Object.entries(versions)) install(root, name, {name, version});
  return root;
}
function install(root: string, name: string, manifest: unknown) {
  const dir = path.join(root, 'node_modules', name);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
  return dir;
}
const required = {react: '19.3.0', 'react-native': '0.88.0-rc.2', expo: '58.0.0'};

describe('inspectCompatibility', () => {
  it('keeps the tested tuple synchronized with installed workspace dependencies', () => {
    const report = inspectCompatibility(path.resolve(import.meta.dirname, '..'));
    expect(report.packages).toEqual(TESTED_DEPENDENCIES);
  });
  it('reports required dependencies missing without falling back to CLI dependencies', () => {
    const report = inspectCompatibility(project());
    expect(report.ok).toBe(false);
    expect(report.tested).toBe(false);
    expect(report.issues).toHaveLength(3);
    for (const name of Object.keys(required)) {
      expect(report.packages[name]).toBeNull();
      expect(report.issues).toContainEqual(expect.objectContaining({code: 'MISSING_DEPENDENCY', severity: 'error', package: name, message: expect.stringMatching(/install/i)}));
    }
    expect(report.issues.find(issue => issue.package === 'expo')?.message).toContain('Expo Metro');
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
  it('allows absent optional libraries and recognizes the installed tested tuple', () => {
    const report = inspectCompatibility(project(required));
    expect(report).toMatchObject({ok: true, tested: true, issues: [], packages: required});
    expect(report.packages['@expo/ui']).toBeNull();
    expect(inspectCompatibility(project({...TESTED_DEPENDENCIES}))).toMatchObject({ok: true, tested: true, issues: []});
  });
  it('uses installed app versions, not declared ranges or CLI versions', () => {
    const report = inspectCompatibility(project({...required, react: '19.2.0'}));
    expect(report.packages.react).toBe('19.2.0');
    expect(report).toMatchObject({ok: true, tested: false});
    expect(report.issues).toContainEqual(expect.objectContaining({package: 'react', severity: 'warning', expected: '19.3.0', actual: '19.2.0'}));
  });
  it.each(['0.87.9', '1.88.0'])('rejects a different RN major/minor: %s', version => {
    const report = inspectCompatibility(project({...required, 'react-native': version}));
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({code: 'RN_VERSION_MISMATCH', severity: 'error', expected: required['react-native'], actual: version}));
  });
  it.each(['0.88.1', '0.88.0', '0.88.0-rc.3'])('warns on RN patch/prerelease changes: %s', version => {
    expect(inspectCompatibility(project({...required, 'react-native': version}))).toMatchObject({ok: true, tested: false, issues: [expect.objectContaining({severity: 'warning'})]});
  });
  it('compares RN to supplied host metadata', () => {
    const report = inspectCompatibility(project(required), {rnVersion: '0.89.0'});
    expect(report.issues).toContainEqual(expect.objectContaining({severity: 'error', package: 'react-native', expected: '0.89.0', actual: '0.88.0-rc.2'}));
  });
  it('warns for exact native library mismatches against baseline and host', () => {
    const root = project({...required, 'react-native-screens': '4.29.0'});
    expect(inspectCompatibility(root).issues).toContainEqual(expect.objectContaining({severity: 'warning', package: 'react-native-screens', expected: '4.28.0', actual: '4.29.0'}));
    expect(inspectCompatibility(root, {nativeLibs: {'react-native-screens': '4.30.0'}}).issues).toContainEqual(expect.objectContaining({expected: '4.30.0', actual: '4.29.0'}));
    expect(inspectCompatibility(root, {nativeLibs: {'react-native-screens': null}}).issues).toContainEqual(expect.objectContaining({severity: 'warning', expected: null}));
  });
  it('does not call a nonbaseline tuple tested even when it matches host metadata', () => {
    const root = project({...required, 'react-native': '0.89.0', 'react-native-screens': '4.29.0'});
    expect(inspectCompatibility(root, {rnVersion: '0.89.0', nativeLibs: {'react-native-screens': '4.29.0'}})).toMatchObject({ok: true, tested: false});
  });
  it('resolves a hidden package manifest through its entry without executing code', () => {
    const root = project(required);
    const dir = install(root, '@expo/ui', {name: '@expo/ui', version: '58.0.9', exports: './dist/index.js'});
    fs.mkdirSync(path.join(dir, 'dist'));
    fs.writeFileSync(path.join(dir, 'dist/package.json'), JSON.stringify({type: 'module'}));
    fs.writeFileSync(path.join(dir, 'dist/index.js'), 'throw new Error("must not execute");');
    expect(inspectCompatibility(root)).toMatchObject({tested: true, packages: {'@expo/ui': '58.0.9'}});
  });
  it.each(['{broken', '{"name":"react"}', '{"name":"react","version":42}', '{"name":"react","version":"banana"}'])('diagnoses malformed manifests: %s', contents => {
    const root = project(required);
    fs.writeFileSync(path.join(root, 'node_modules/react/package.json'), contents);
    expect(inspectCompatibility(root)).toMatchObject({ok: false, tested: false, issues: [expect.objectContaining({code: 'INVALID_PACKAGE_MANIFEST', package: 'react', severity: 'error'})]});
  });
  it('supports dependencies hoisted in the app workspace', () => {
    const root = project(required);
    const app = path.join(root, 'apps/mobile');
    fs.mkdirSync(app, {recursive: true});
    fs.writeFileSync(path.join(app, 'package.json'), '{}');
    expect(inspectCompatibility(app)).toMatchObject({ok: true, tested: true});
  });
});
