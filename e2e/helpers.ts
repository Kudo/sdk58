/**
 * Shared e2e helpers: the host binary, the preset matrix and CLI runs.
 *
 * RN_A11Y_E2E_PRESETS (default `android-phone,ios-phone`) selects the
 * presets every suite runs under; each test name starts with `[<preset>]`.
 */

import {spawnSync, type SpawnSyncReturns} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {expect, type TestContext} from 'vitest';

import {DEFAULT_HOST_BIN} from '../src/host.ts';
import {type PresetName, PRESETS} from '../src/presets.ts';
import type {TreeNode} from '../src/schema.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = path.join(ROOT, 'src', 'cli.ts');

// native/dist/<arch>/rn-a11y-host (.exe on Windows).
const DIST_BIN = DEFAULT_HOST_BIN;
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

/** The E2E preset `name` for a test written for one preset; skips the test when RN_A11Y_E2E_PRESETS leaves it out. */
export function e2ePreset(t: TestContext, name: PresetName): Preset {
  const preset = E2E_PRESETS.find(p => p.name === name);
  if (preset == null) t.skip(`${name} is not in RN_A11Y_E2E_PRESETS`);
  return preset;
}

export function isIOS(preset: Preset): boolean {
  return preset.platform === 'ios';
}

/** Runs the CLI with `--preset <preset>` (after the command and file). */
export function cli(args: string[], preset: Preset, input?: string): SpawnSyncReturns<string> {
  return spawnSync('node', [CLI, ...args, '--preset', preset.name], {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    env: {...process.env, RN_A11Y_HOST_BIN: hostBin},
    maxBuffer: 256 * 1024 * 1024,
  });
}

export function cliJson<T>(args: string[], preset: Preset, expectedStatus = 0): T {
  const proc = cli(args, preset);
  expect(proc.status, `rn-a11y-tree ${args.join(' ')} --preset ${preset.name}:\n${proc.stderr}`).toBe(expectedStatus);
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
  if (found == null) expect.unreachable(`${testID} not found`);
  return found;
}
