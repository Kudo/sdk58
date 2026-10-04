import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(ROOT, 'packages/react-native-a11y-tree/src/cli.ts');
function run(args: string[]) {
  return spawnSync(process.execPath, [CLI, 'skill', ...args], {cwd: ROOT, encoding: 'utf8'});
}

describe('Printing agent guidance', () => {
  it('should print the bundled skill to stdout', () => {
    const printed = run([]);
    expect(printed.status, printed.stderr).toBe(0);
    expect(printed.stdout).toBe(fs.readFileSync(path.join(ROOT, 'packages/react-native-a11y-tree/skill/SKILL.md'), 'utf8'));
    expect(printed.stderr).toBe('');
  });

  it('should print guidance with stderr suppression enabled', () => {
    const printed = run(['--no-stderr']);
    expect(printed.status).toBe(0);
    expect(printed.stdout).toBe(run([]).stdout);
    expect(printed.stderr).toBe('');
  });

  it('should advertise only printing guidance in help', () => {
    const help = run(['--help']);
    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toContain('print the bundled agent guidance to stdout');
    for (const flag of ['--install', '--check', '--path']) expect(help.stdout).not.toContain(flag);
  });

  it.each(['--install', '--check', '--path'])('should reject the removed %s option', flag => {
    const result = run([flag]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    const {error} = JSON.parse(result.stderr);
    expect(error.code).toBe('USAGE');
    expect(error.message).toContain(flag);
  });
});
