import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, it} from 'vitest';
import {loadProjectPaths} from '../packages/react-native-a11y-tree/src/tsconfigPaths.ts';

const dirs: string[] = [];
function project() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-paths-')));
  dirs.push(dir);
  return dir;
}
function write(dir: string, name: string, value: unknown) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(value));
}
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, {recursive: true, force: true})));

it('uses the most specific alias and exact matches, with ordered fallbacks', () => {
  const dir = project();
  write(dir, 'tsconfig.json', {compilerOptions: {paths: {
    '@/*': ['./src/*'], '@/assets/*': ['./assets/*'], '@/components/view': ['./special', './fallback'],
  }}});
  const {match} = loadProjectPaths(dir);
  expect(match('@/components/view')).toEqual([path.join(dir, 'special'), path.join(dir, 'fallback')]);
  expect(match('@/components/button')).toEqual([path.join(dir, 'src/components/button')]);
  expect(match('@/assets/icon.png')).toEqual([path.join(dir, 'assets/icon.png')]);
  expect(match('./relative')).toEqual([]);
});

it('reads JSONC and package extends, resolving paths relative to their defining config', () => {
  const dir = project();
  write(dir, 'node_modules/config/package.json', {name: 'config', version: '1.0.0'});
  write(dir, 'node_modules/config/base.json', {compilerOptions: {baseUrl: './app', paths: {'@/*': ['src/*']}}});
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{ // Expo-style config\n "extends": "config/base",\n }');
  expect(loadProjectPaths(dir).match('@/view')).toEqual([path.join(dir, 'node_modules/config/app/src/view')]);
});

it('invalidates the cache key on inherited edits and config creation/removal', () => {
  const dir = project();
  const absent = loadProjectPaths(dir).key;
  write(dir, 'base.json', {compilerOptions: {paths: {'@/*': ['./one/*']}}});
  write(dir, 'tsconfig.json', {extends: './base.json'});
  const first = loadProjectPaths(dir);
  expect(first.key).not.toBe(absent);
  expect(loadProjectPaths(dir).key).toBe(first.key);
  write(dir, 'base.json', {compilerOptions: {paths: {'@/*': ['./two/*']}}});
  const second = loadProjectPaths(dir);
  expect(second.key).not.toBe(first.key);
  expect(second.match('@/view')).toEqual([path.join(dir, 'two/view')]);
  fs.unlinkSync(path.join(dir, 'tsconfig.json'));
  expect(loadProjectPaths(dir).key).toBe(absent);
});

it('supports jsconfig and baseUrl, with tsconfig taking precedence', () => {
  const dir = project();
  write(dir, 'jsconfig.json', {compilerOptions: {baseUrl: './src'}});
  expect(loadProjectPaths(dir).match('components/view')).toEqual([path.join(dir, 'src/components/view')]);
  write(dir, 'tsconfig.json', {});
  expect(loadProjectPaths(dir).match('components/view')).toEqual([]);
});

it('reports invalid inherited configs rather than silently ignoring aliases', () => {
  const dir = project();
  write(dir, 'tsconfig.json', {extends: './missing.json'});
  expect(() => loadProjectPaths(dir)).toThrow(/missing/);
});

it('tracks inherited paths without baseUrl and sources outside the project', () => {
  const dir = project();
  write(dir, 'shared/base.json', {compilerOptions: {paths: {'@/*': ['./src/*']}}});
  write(dir, 'app/tsconfig.json', {extends: '../shared/base.json'});
  fs.mkdirSync(path.join(dir, 'shared/src'));
  const loaded = loadProjectPaths(path.join(dir, 'app'));
  expect(loaded.match('@/view')).toEqual([path.join(dir, 'shared/src/view')]);
  expect(loaded.watchFolders).toContain(path.join(dir, 'shared/src'));
  write(dir, 'other/base.json', {compilerOptions: {paths: {'@/*': ['./src/*']}}});
  write(dir, 'app/tsconfig.json', {extends: '../other/base.json'});
  expect(loadProjectPaths(path.join(dir, 'app')).key).not.toBe(loaded.key);
});
