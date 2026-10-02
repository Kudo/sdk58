import {EventEmitter} from 'node:events';
import type {ChildProcess} from 'node:child_process';
import {afterEach, expect, it, vi} from 'vitest';
import {terminateWindowsTree} from '../packages/react-native-a11y-tree/src/processCleanup.ts';

afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks();});
function setup() {
  const root = {pid:1234,exitCode:null as number | null,signalCode:null as NodeJS.Signals | null,kill:vi.fn(() => true)};
  const helper = Object.assign(new EventEmitter(), {kill:vi.fn(() => true),unref:vi.fn(),exitCode:null,signalCode:null});
  const spawn = vi.fn(() => helper as unknown as ChildProcess);
  const dependencies = {spawn,systemRoot:'C:\\Windows'};
  return {root,helper,spawn,dependencies};
}
it('uses the system executable and argument array, waits for helper close, and does not kill the root first', async () => {
  const {root,helper,spawn,dependencies} = setup();
  let settled = false;
  const result = terminateWindowsTree(root, dependencies).then(value => {settled=true; return value;});
  expect(spawn).toHaveBeenCalledWith('C:\\Windows\\System32\\taskkill.exe', ['/PID','1234','/T','/F'],
    {shell:false,windowsHide:true,stdio:'ignore'});
  expect(root.kill).not.toHaveBeenCalled();
  helper.emit('exit',0,null);
  await Promise.resolve();
  expect(settled).toBe(false);
  root.exitCode = 1;
  helper.emit('close',0,null);
  expect(await result).toEqual({});
  expect(helper.eventNames()).toEqual([]);
});
it.each(['already exited','signalled','missing pid'] as const)('never invokes taskkill when the root is %s', async mode => {
  const {root,spawn,dependencies} = setup();
  if (mode === 'already exited') root.exitCode = 0;
  if (mode === 'signalled') root.signalCode = 'SIGTERM';
  if (mode === 'missing pid') root.pid = undefined as unknown as number;
  const result = await terminateWindowsTree(root, dependencies);
  expect(spawn).not.toHaveBeenCalled();
  expect(root.kill).not.toHaveBeenCalled();
  if (mode !== 'missing pid') expect(result).toMatchObject({cleanupIncomplete:true,cleanupReason:'root-exited'});
});
it.each([undefined,'Windows','C:Windows','\\\\server\\Windows'])('rejects an unsafe or missing SystemRoot: %s', async systemRoot => {
  const {root,spawn,dependencies} = setup();
  const result = await terminateWindowsTree(root, {...dependencies,systemRoot});
  expect(spawn).not.toHaveBeenCalled();
  expect(result).toMatchObject({cleanupIncomplete:true,cleanupReason:'system-root-unavailable'});
  expect(root.kill).toHaveBeenCalledWith('SIGKILL');
});
it('falls back on a nonzero helper exit without hiding the failure', async () => {
  const {root,helper,dependencies} = setup();
  const result = terminateWindowsTree(root, dependencies);
  helper.emit('close',5,null);
  expect(await result).toMatchObject({cleanupIncomplete:true,cleanupReason:'taskkill-failed',cleanupExitCode:5});
  expect(root.kill).toHaveBeenCalledOnce();
});
it('handles spawn errors and waits for close without leaking error listeners', async () => {
  const {root,helper,dependencies} = setup();
  const result = terminateWindowsTree(root, dependencies);
  helper.emit('error',new Error('ENOENT'));
  helper.emit('close',-2,null);
  expect(await result).toMatchObject({cleanupIncomplete:true,cleanupReason:'taskkill-spawn-failed'});
  expect(root.kill).toHaveBeenCalledWith('SIGKILL');
  expect(helper.eventNames()).toEqual([]);
});
it('bounds a hung helper, kills it before returning, and clears timers', async () => {
  vi.useFakeTimers();
  const {root,helper,dependencies} = setup();
  const result = terminateWindowsTree(root, dependencies);
  await vi.advanceTimersByTimeAsync(750);
  expect(helper.kill).toHaveBeenCalledWith('SIGKILL');
  expect(root.kill).toHaveBeenCalledWith('SIGKILL');
  helper.emit('close',null,'SIGKILL');
  expect(await result).toMatchObject({cleanupIncomplete:true,cleanupReason:'taskkill-timeout',cleanupTimedOut:true});
  expect(vi.getTimerCount()).toBe(0);
});
it('hard-cuts off an unreapable helper and safely handles a delayed error/close', async () => {
  vi.useFakeTimers();
  const {helper,dependencies} = setup();
  const result = terminateWindowsTree(setup().root, {...dependencies});
  await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toMatchObject({cleanupIncomplete:true,cleanupTimedOut:true});
  expect(helper.unref).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  expect(() => helper.emit('error',new Error('late failure'))).not.toThrow();
  helper.emit('close',null,'SIGKILL');
  expect(helper.eventNames()).toEqual([]);
});
it('does not root-kill a PID whose process exits while taskkill is running', async () => {
  const {root,helper,dependencies} = setup();
  const result = terminateWindowsTree(root, dependencies);
  root.exitCode = 0;
  helper.emit('close',1,null);
  await result;
  expect(root.kill).not.toHaveBeenCalled();
});

it('preserves the timeout reason if killing the helper also emits an error', async () => {
  vi.useFakeTimers();
  const {root,helper,dependencies}=setup();
  const result=terminateWindowsTree(root,dependencies);
  await vi.advanceTimersByTimeAsync(750);
  helper.emit('error',new Error('kill failed'));
  helper.emit('close',null,'SIGKILL');
  expect(await result).toMatchObject({cleanupIncomplete:true,cleanupReason:'taskkill-timeout',cleanupTimedOut:true});
});

it('falls back when spawning taskkill throws synchronously', async () => {
  const {root,spawn,dependencies}=setup();
  spawn.mockImplementation(()=>{throw new Error('spawn failed');});
  expect(await terminateWindowsTree(root,dependencies)).toMatchObject({cleanupIncomplete:true,cleanupReason:'taskkill-spawn-failed'});
  expect(root.kill).toHaveBeenCalledOnce();
});
