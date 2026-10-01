/**
 * npm and npx for the tests. On Windows they are `npm.cmd` / `npx.cmd`, which
 * Node only starts through a shell; arguments with spaces are quoted.
 */

import {spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns} from 'node:child_process';

const WINDOWS = process.platform === 'win32';

const quote = (arg: string) => (/[\s"&|<>^]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg);

export function npmTool(
  tool: 'npm' | 'npx',
  args: string[],
  options: Omit<SpawnSyncOptionsWithStringEncoding, 'encoding'> = {},
): SpawnSyncReturns<string> {
  return WINDOWS
    ? spawnSync(`${tool}.cmd`, args.map(quote), {...options, encoding: 'utf8', shell: true})
    : spawnSync(tool, args, {...options, encoding: 'utf8'});
}

export const hasNpm = npmTool('npm', ['--version'], {stdio: 'ignore'}).status === 0;
