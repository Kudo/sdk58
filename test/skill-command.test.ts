import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {expect, it} from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(ROOT, 'packages/react-native-a11y-tree/src/cli.ts');
function run(args: string[]) {
  return spawnSync(process.execPath, [CLI, 'skill', ...args], {cwd: ROOT, encoding: 'utf8'});
}

it('prints the bundled skill and detects installed drift', () => {
  const printed = run([]);
  expect(printed.status, printed.stderr).toBe(0);
  expect(printed.stdout).toMatch(/^---\nname: react-native-a11y-tree\ndescription:/);
  const bundledPath = run(['--path']);
  expect(bundledPath.status).toBe(0);
  expect(fs.readFileSync(bundledPath.stdout.trim(), 'utf8')).toBe(printed.stdout);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-skill-'));
  try {
    expect(run(['--install', dir]).status).toBe(0);
    const installed = path.join(dir, 'react-native-a11y-tree', 'SKILL.md');
    expect(fs.readFileSync(installed, 'utf8')).toBe(printed.stdout);
    expect(run(['--check', dir]).status).toBe(0);
    fs.appendFileSync(installed, '\nchanged\n');
    expect(run(['--check', dir]).status).toBe(1);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
