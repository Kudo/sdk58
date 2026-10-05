import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {publishPackages} from '../scripts/publish-packages.ts';

const NAMES = [
  '@react-native-a11y-tree/runtime-darwin-universal',
  '@react-native-a11y-tree/runtime-linux-x64-gnu',
  '@react-native-a11y-tree/runtime-win32-x64-msvc',
  'react-native-a11y-tree',
];
let directory: string;
let version: string;
let metadata: Record<string, {name: string; version: string; repository: {url: string}; optionalDependencies?: Record<string, string>}>;
let published: Map<string, string>;
let run: ReturnType<typeof vi.fn<(command: string, args: string[]) => string>>;
const log = vi.fn();

function archive(name: string) {
  return path.join(directory, `${name.replace('@', '').replace('/', '-')}-${version}.tgz`);
}
function integrity(name: string) {
  return `sha512-${createHash('sha512').update(fs.readFileSync(archive(name))).digest('base64')}`;
}
function prepare(releaseVersion = '0.1.7') {
  version = releaseVersion;
  metadata = {};
  for (const name of NAMES) {
    fs.writeFileSync(archive(name), `verified archive for ${name}@${version}`);
    metadata[path.basename(archive(name))] = {name, version, repository: {url: 'https://github.com/Kudo/react-native-a11y-tree.git'}};
  }
  metadata[path.basename(archive('react-native-a11y-tree'))].optionalDependencies = Object.fromEntries(NAMES.slice(0, 3).map(name => [name, version]));
}
function registry(command: string, args: string[]) {
  if (command === 'tar') return JSON.stringify(metadata[path.basename(args[1])]);
  if (args[0] === 'view') {
    if (args[2] === 'versions') return JSON.stringify(published.has(args[1]) ? ['0.1.6', version] : '0.1.6');
    return JSON.stringify(published.get(args[1].slice(0, args[1].lastIndexOf('@'))));
  }
  const name = metadata[path.basename(args[1])].name;
  published.set(name, integrity(name));
  return `Published ${name}`;
}
function publishCalls() {
  return run.mock.calls.filter(([command, args]) => command === 'npm' && args[0] === 'publish');
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-publish-test-'));
  published = new Map();
  log.mockClear();
  prepare();
  run = vi.fn(registry);
});
afterEach(() => fs.rmSync(directory, {recursive: true, force: true}));

describe('Publishing verified release packages', () => {
  it('should publish the verified runtime archives before the CLI with provenance and no lifecycle scripts', () => {
    publishPackages(directory, 'v0.1.7', run, log);
    expect(publishCalls().map(([, args]) => args[1])).toEqual(NAMES.map(archive));
    for (const [, args] of publishCalls()) {
      expect(args.slice(2)).toEqual(['--ignore-scripts', '--provenance', '--access', 'public', '--tag', 'latest', '--registry', 'https://registry.npmjs.org']);
    }
  });

  it('should use the next distribution tag for prereleases', () => {
    for (const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, file));
    prepare('0.1.8-beta.1');
    publishPackages(directory, 'v0.1.8-beta.1', run, log);
    expect(publishCalls()).toHaveLength(4);
    expect(publishCalls().every(([, args]) => args[args.indexOf('--tag') + 1] === 'next')).toBe(true);
  });

  it('should reject a branch name before invoking any commands', () => {
    expect(() => publishPackages(directory, 'main', run, log)).toThrow('version tag');
    expect(run).not.toHaveBeenCalled();
  });

  it.each(['missing', 'extra'])('should reject %s npm archives before publishing', kind => {
    if (kind === 'missing') fs.unlinkSync(archive(NAMES[0]));
    else fs.writeFileSync(path.join(directory, 'unexpected.tgz'), 'extra');
    expect(() => publishPackages(directory, 'v0.1.7', run, log)).toThrow('exactly the CLI and three runtime');
    expect(run).not.toHaveBeenCalled();
  });

  it.each(['name', 'version', 'repository'])('should reject incorrect %s metadata without publishing', field => {
    const pkg = metadata[path.basename(archive(NAMES[0]))];
    if (field === 'repository') pkg.repository.url = 'wrong';
    else pkg[field as 'name' | 'version'] = 'wrong';
    expect(() => publishPackages(directory, 'v0.1.7', run, log)).toThrow('metadata does not match');
    expect(publishCalls()).toHaveLength(0);
  });

  it('should reject mismatched CLI runtime dependencies before querying the registry', () => {
    metadata[path.basename(archive('react-native-a11y-tree'))].optionalDependencies![NAMES[0]] = '0.1.6';
    expect(() => publishPackages(directory, 'v0.1.7', run, log)).toThrow('runtime dependency does not match');
    expect(run.mock.calls.every(([command]) => command === 'tar')).toBe(true);
  });

  it('should skip only already published archives with identical integrity', () => {
    for (const name of NAMES) published.set(name, integrity(name));
    publishPackages(directory, 'v0.1.7', run, log);
    expect(publishCalls()).toHaveLength(0);
    expect(log).toHaveBeenCalledTimes(4);
  });

  it('should reject an existing different CLI archive before publishing any runtimes', () => {
    published.set('react-native-a11y-tree', 'sha512-different');
    expect(() => publishPackages(directory, 'v0.1.7', run, log)).toThrow('differs from the verified release');
    expect(publishCalls()).toHaveLength(0);
  });

  it('should stop on registry errors instead of treating them as unpublished versions', () => {
    run.mockImplementation((command, args) => {
      if (command === 'npm') throw new Error('registry unavailable');
      return registry(command, args);
    });
    expect(() => publishPackages(directory, 'v0.1.7', run, log)).toThrow('registry unavailable');
    expect(publishCalls()).toHaveLength(0);
  });

  it('should reject invalid registry responses without publishing', () => {
    run.mockImplementation((command, args) => command === 'npm' ? 'null' : registry(command, args));
    expect(() => publishPackages(directory, 'v0.1.7', run, log)).toThrow('Invalid registry version response');
    expect(publishCalls()).toHaveLength(0);
  });

  it('should resume a partial release without publishing the CLI before its runtimes', () => {
    run.mockImplementation((command, args) => {
      if (args[0] === 'publish' && args[1] === archive(NAMES[1])) throw new Error('publish interrupted');
      return registry(command, args);
    });
    expect(() => publishPackages(directory, 'v0.1.7', run, log)).toThrow('publish interrupted');
    expect([...published.keys()]).toEqual([NAMES[0]]);
    run.mockClear().mockImplementation(registry);
    publishPackages(directory, 'v0.1.7', run, log);
    expect(publishCalls().map(([, args]) => args[1])).toEqual(NAMES.slice(1).map(archive));
  });
});
