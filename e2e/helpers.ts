/**
 * Shared e2e helpers: the host binary, the preset matrix and CLI runs.
 *
 * RN_A11Y_E2E_PRESETS (default `android-phone,ios-phone`) selects the
 * presets every suite runs under; each test name starts with `[<preset>]`.
 */

import assert from 'node:assert/strict';
import {spawnSync, type SpawnSyncReturns} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {type PresetName, PRESETS} from '../src/presets.ts';
import type {TreeNode} from '../src/schema.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = path.join(ROOT, 'bin', 'rn-a11y-tree.js');

const DIST_BIN = path.join(ROOT, 'native', 'dist', process.arch === 'x64' ? 'x86_64' : process.arch, 'rn-a11y-host');
export const hostBin = process.env.RN_A11Y_HOST_BIN || (fs.existsSync(DIST_BIN) ? DIST_BIN : undefined);

/** `skip` option for tests that need the real host. */
export const hostSkip: string | false = hostBin
  ? false
  : `no host binary: run \`bun run build:host\` (creates ${path.relative(ROOT, DIST_BIN)}) or set RN_A11Y_HOST_BIN`;

export type Preset = {name: PresetName} & (typeof PRESETS)[PresetName];

export const E2E_PRESETS: Preset[] = (process.env.RN_A11Y_E2E_PRESETS || 'android-phone,ios-phone')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean)
  .map((name: string) => {
    const preset = PRESETS[name as PresetName];
    if (preset == null) throw new Error(`RN_A11Y_E2E_PRESETS: unknown preset "${name}"`);
    return {name: name as PresetName, ...preset};
  });

export function isIOS(preset: Preset): boolean {
  return preset.platform === 'ios';
}

/** Runs the CLI with `--preset <preset>` (after the command and file). */
export function cli(args: string[], preset: Preset, input?: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CLI, ...args, '--preset', preset.name], {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    env: {...process.env, RN_A11Y_HOST_BIN: hostBin},
    maxBuffer: 256 * 1024 * 1024,
  });
}

export function cliJson<T>(args: string[], preset: Preset, expectedStatus = 0): T {
  const proc = cli(args, preset);
  assert.equal(proc.status, expectedStatus, `rn-a11y-tree ${args.join(' ')} --preset ${preset.name}:\n${proc.stderr}`);
  return JSON.parse(proc.stdout) as T;
}

const capabilityCache = new Map<string, string[]>();

/** The host's capabilities (from a `run` with one snapshot), per platform. */
export function hostCapabilities(preset: Preset): string[] {
  const cached = capabilityCache.get(preset.platform);
  if (cached) return cached;
  const result = cliJson<{capabilities: string[]}>(
    ['run', path.join(ROOT, 'examples/basic/App.tsx'), '--script', '[{"snapshot":"s"}]'],
    preset,
  );
  capabilityCache.set(preset.platform, result.capabilities);
  return result.capabilities;
}

/**
 * iOS-named TextInput/Switch shadow nodes (`iosInputs` capability). Without
 * them, `--platform ios` bundles render those components as 0-size interop
 * nodes, so their assertions are skipped with this reason.
 */
export const IOS_INPUTS = 'iosInputs';
export const NO_IOS_INPUTS = 'host lacks iOS TextInput/Switch';

/** False when the inputs are real for this preset, else the skip reason. */
export function inputsSkip(preset: Preset): string | false {
  return isIOS(preset) && !hostCapabilities(preset).includes(IOS_INPUTS) ? NO_IOS_INPUTS : false;
}

export function findAll(node: TreeNode, pred: (n: TreeNode) => boolean): TreeNode[] {
  const out = pred(node) ? [node] : [];
  for (const child of node.children) out.push(...findAll(child, pred));
  return out;
}

export function find(node: TreeNode, testID: string): TreeNode | undefined {
  return findAll(node, n => n.testID === testID)[0];
}

export function get(node: TreeNode, testID: string): TreeNode {
  const found = find(node, testID);
  assert.ok(found, `${testID} not found`);
  return found;
}
