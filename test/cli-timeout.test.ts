import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {expect, it} from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(ROOT, 'packages/react-native-a11y-tree/src/cli.ts');
const APP = path.join(ROOT, 'examples/basic/App.tsx');

it('render/run/check deadlines report TIMEOUT and never retry timed-out bytecode', {timeout: 120_000}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-cli-timeout-'));
  try {
    const host = path.join(dir, 'hang.cjs');
    const count = path.join(dir, 'starts');
    fs.writeFileSync(host, "require('node:fs').appendFileSync(process.env.TEST_HOST_STARTS, process.argv.join(' ') + '\\n'); setInterval(() => {}, 1000);");
    for (const command of ['render', 'run', 'check']) {
      fs.writeFileSync(count, '');
      const proc = spawnSync(process.execPath, [CLI, command, APP, '--preset', 'android-phone', '--format', 'json', '--bytecode', 'on', '--timeout', '1500',
        ...(command === 'run' ? ['--script', '[]'] : command === 'check' ? ['--rules', '{"rules":{}}'] : [])], {
        cwd: ROOT, encoding: 'utf8', timeout: 90_000,
        env: {...process.env, RN_A11Y_HOST_BIN: host, RN_A11Y_HOST_RUNNER: process.execPath, TEST_HOST_STARTS: count},
      });
      expect(proc.status, `${command}: ${proc.stdout} ${proc.stderr}`).toBe(5);
      expect(JSON.parse(proc.stdout).error.code).toBe('TIMEOUT');
      expect(proc.stderr).not.toContain('using JS');
      const starts = fs.readFileSync(count, 'utf8').trim().split('\n');
      expect(starts).toHaveLength(1);
      expect(starts[0]).toContain('.hbc');
    }
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});

it('rejects overflowing or fractional one-shot deadlines before doing work', () => {
  for (const timeout of ['0', '0.5', '2147483648', 'Infinity']) {
    const proc = spawnSync(process.execPath, [CLI, 'render', APP, '--timeout', timeout], {cwd: ROOT, encoding: 'utf8', timeout: 10_000});
    expect(proc.status, proc.stderr).toBe(1);
  }
});


it.skipIf(process.platform === 'win32')('repeated SIGTERM cancels a resistant host without orphaning it or retrying bytecode', {timeout: 120_000}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-cli-cancel-'));
  const marker = path.join(dir, 'pid');
  const host = path.join(dir, 'hang.cjs');
  fs.writeFileSync(host, "require('node:fs').writeFileSync(process.env.TEST_HOST_PID, String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);");
  const child = spawn(process.execPath, [CLI, 'render', APP, '--preset', 'android-phone', '--format', 'json', '--bytecode', 'on'], {
    cwd: ROOT, env: {...process.env, RN_A11Y_HOST_BIN: host, RN_A11Y_HOST_RUNNER: process.execPath, TEST_HOST_PID: marker}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => {stdout += data;});
  child.stderr.on('data', data => {stderr += data;});
  const closed = new Promise<number | null>((resolve, reject) => {child.once('error', reject); child.once('close', resolve);});
  try {
    const startDeadline = Date.now() + 90_000;
    while (!fs.existsSync(marker) && child.exitCode === null && Date.now() < startDeadline) await new Promise(resolve => setTimeout(resolve, 25));
    expect(fs.existsSync(marker), stderr + stdout).toBe(true);
    child.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 75));
    child.kill('SIGTERM');
    let cutoff: ReturnType<typeof setTimeout> | undefined;
    const code = await Promise.race([closed, new Promise((_, reject) => {cutoff = setTimeout(() => {child.kill('SIGKILL'); reject(new Error('CLI did not cancel'));}, 5000);})]).finally(() => clearTimeout(cutoff));
    expect(code, stdout + stderr).toBe(5);
    expect(JSON.parse(stdout).error).toMatchObject({code: 'HOST_CRASHED', details: {cancelled: true}});
    expect(stderr).not.toContain('using JS');
    const pid = Number(fs.readFileSync(marker, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    child.kill('SIGKILL');
    if (fs.existsSync(marker)) {try {process.kill(Number(fs.readFileSync(marker, 'utf8')), 'SIGKILL');} catch {}}
    fs.rmSync(dir, {recursive: true, force: true});
  }
});


it('shares one deadline across a delayed bytecode failure and its JS retry', {timeout: 120_000}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-cli-retry-deadline-'));
  try {
    const host = path.join(dir, 'retry.cjs');
    const starts = path.join(dir, 'starts');
    fs.writeFileSync(host, "require('node:fs').appendFileSync(process.env.TEST_HOST_STARTS, process.argv.join(' ') + '\\n'); if (process.argv.some(arg => arg.endsWith('.hbc'))) setTimeout(() => process.exit(2), 1000); else setInterval(() => {}, 1000);");
    const proc = spawnSync(process.execPath, [CLI, 'render', APP, '--preset', 'android-phone', '--format', 'json', '--bytecode', 'on', '--timeout', '2000'], {
      cwd: ROOT, encoding: 'utf8', timeout: 90_000,
      env: {...process.env, RN_A11Y_HOST_BIN: host, RN_A11Y_HOST_RUNNER: process.execPath, TEST_HOST_STARTS: starts},
    });
    expect(proc.status, proc.stdout + proc.stderr).toBe(5);
    const error = JSON.parse(proc.stdout).error;
    expect(error.code).toBe('TIMEOUT');
    expect(proc.stderr).toContain('using JS');
    expect(fs.readFileSync(starts, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(Number(/after (\d+) ms/.exec(error.message)?.[1])).toBeLessThan(1200);
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});
