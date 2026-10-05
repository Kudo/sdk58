#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REGISTRY = 'https://registry.npmjs.org';
const REPOSITORY = 'https://github.com/Kudo/react-native-a11y-tree.git';
const RUNTIMES = ['darwin-universal', 'linux-x64-gnu', 'win32-x64-msvc'];
type Execute = (command: string, args: string[]) => string;
const execute: Execute = (command, args) => execFileSync(command, args, {encoding: 'utf8'});

export function publishPackages(directory: string, tag: string, run: Execute = execute, log = console.log) {
  const version = tag.match(/^v(\d+\.\d+\.\d+(?:-[\w.-]+)?)$/)?.[1];
  if (!version) throw new Error('Publishing requires a version tag, such as v0.1.7.');
  const specs = [
    ...RUNTIMES.map(runtime => ({name: `@react-native-a11y-tree/runtime-${runtime}`, file: `react-native-a11y-tree-runtime-${runtime}-${version}.tgz`})),
    {name: 'react-native-a11y-tree', file: `react-native-a11y-tree-${version}.tgz`},
  ];
  const files = fs.readdirSync(directory).filter(file => file.endsWith('.tgz')).sort();
  if (JSON.stringify(files) !== JSON.stringify(specs.map(spec => spec.file).sort())) {
    throw new Error('Release must contain exactly the CLI and three runtime npm tarballs for the tag version.');
  }
  const packages = specs.map(spec => {
    const archive = path.resolve(directory, spec.file);
    const metadata = JSON.parse(run('tar', ['-xOf', archive, 'package/package.json']));
    if (metadata.name !== spec.name || metadata.version !== version || metadata.repository?.url !== REPOSITORY) {
      throw new Error(`Release metadata does not match the tag/repository: ${spec.file}`);
    }
    if (spec.name === 'react-native-a11y-tree') {
      for (const runtime of RUNTIMES) {
        if (metadata.optionalDependencies?.[`@react-native-a11y-tree/runtime-${runtime}`] !== version) {
          throw new Error(`CLI runtime dependency does not match ${version}: ${runtime}`);
        }
      }
    }
    const integrity = `sha512-${createHash('sha512').update(fs.readFileSync(archive)).digest('base64')}`;
    return {...spec, archive, integrity};
  });

  // Preflight every package before publishing; a retry can resume a partial release.
  const pending = packages.filter(pkg => {
    const versions: string | string[] = JSON.parse(run('npm', ['view', pkg.name, 'versions', '--json', '--registry', REGISTRY]));
    if (typeof versions !== 'string' && (!Array.isArray(versions) || !versions.every(value => typeof value === 'string'))) {
      throw new Error(`Invalid registry version response for ${pkg.name}.`);
    }
    if (!(Array.isArray(versions) ? versions : [versions]).includes(version)) return true;
    const integrity = JSON.parse(run('npm', ['view', `${pkg.name}@${version}`, 'dist.integrity', '--json', '--registry', REGISTRY]));
    if (integrity !== pkg.integrity) throw new Error(`Published ${pkg.name}@${version} differs from the verified release tarball.`);
    log(`Already published: ${pkg.name}@${version} (integrity matches)`);
    return false;
  });
  for (const pkg of pending) {
    log(`Publishing ${pkg.name}@${version}`);
    const output = run('npm', ['publish', pkg.archive, '--ignore-scripts', '--provenance', '--access', 'public',
      '--tag', version.includes('-') ? 'next' : 'latest', '--registry', REGISTRY]);
    if (output.trim()) log(output.trim());
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishPackages(process.argv[2] ?? 'release', process.env.GITHUB_REF_NAME ?? '');
}
