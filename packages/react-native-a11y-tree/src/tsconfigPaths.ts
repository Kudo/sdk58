import fs from 'node:fs';
import path from 'node:path';
import {createPathsMatcher, parseTsconfig} from 'get-tsconfig';

export type ProjectPaths = {
  key: string;
  match: (specifier: string) => string[];
  watchFolders: string[];
};

/** Read afresh before looking up a cached bundle, including the extends chain. */
export function loadProjectPaths(projectRoot: string): ProjectPaths {
  const configPath = ['tsconfig.json', 'jsconfig.json']
    .map(name => path.join(projectRoot, name)).find(file => fs.existsSync(file));
  if (!configPath) return {key: '', match: () => [], watchFolders: []};
  const config = parseTsconfig(configPath);
  const matcher = createPathsMatcher({path: configPath, config});
  // get-tsconfig returns forward slashes on Windows; expose native paths to Metro.
  const match = (specifier: string): string[] => (matcher?.(specifier) ?? []).map(candidate => path.normalize(candidate));
  // Metro must see alias targets outside the project too (shared workspace sources).
  const probe = '__RN_A11Y_PATH_PROBE__';
  const targets = Object.keys(config.compilerOptions?.paths ?? {})
    .map(pattern => [pattern, match(pattern.replace('*', probe))] as const);
  const roots = targets.flatMap(([, candidates]) => candidates.map(target => target.split(probe)[0]));
  if (config.compilerOptions?.baseUrl) roots.push(path.resolve(projectRoot, config.compilerOptions.baseUrl));
  const watchFolders = roots.map(root => {
    root = path.resolve(root);
    while (!fs.existsSync(root)) root = path.dirname(root);
    return fs.statSync(root).isDirectory() ? root : path.dirname(root);
  });
  return {key: JSON.stringify({configPath, config, targets}), match, watchFolders: [...new Set(watchFolders)]};
}
