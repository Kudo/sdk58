import {spawn, type ChildProcess, type SpawnOptions} from 'node:child_process';
import path from 'node:path';

export type ProcessCleanupResult = {
  cleanupIncomplete?: true;
  cleanupReason?: 'root-exited' | 'system-root-unavailable' | 'taskkill-spawn-failed' | 'taskkill-failed' | 'taskkill-timeout';
  cleanupExitCode?: number | null;
  cleanupTimedOut?: true;
};
type RootProcess = Pick<ChildProcess, 'pid' | 'exitCode' | 'signalCode' | 'kill'>;
type Dependencies = {
  spawn?: (file: string, args: string[], options: SpawnOptions) => ChildProcess;
  systemRoot?: string;
};

// Keep only the helper alive in this closure, not its caller's session state.
function guardLateErrors(child: ChildProcess) {
  const ignore = () => {};
  child.on('error', ignore);
  child.once('close', () => child.removeListener('error', ignore));
}

/** Windows-only, best-effort tree cleanup. Call once, before killing the root.
 * taskkill cannot guarantee descendants after the root has already exited;
 * never launch it against a known-exited root PID. No PATH or shell lookup.
 * The injected dependencies are for tests, not CLI configuration. */
export function terminateWindowsTree(root: RootProcess, dependencies: Dependencies = {}): Promise<ProcessCleanupResult> {
  const pid = root.pid;
  if (pid == null || !Number.isSafeInteger(pid) || pid <= 0) return Promise.resolve({});
  const alive = () => root.exitCode === null && root.signalCode === null;
  if (!alive()) return Promise.resolve({cleanupIncomplete: true, cleanupReason: 'root-exited'});
  let rootKillAttempted = false;
  const fallback = () => {
    if (rootKillAttempted || !alive()) return;
    rootKillAttempted = true;
    try {root.kill('SIGKILL');} catch {} // The caller also has a bounded pipe cutoff.
  };
  const systemRoot = 'systemRoot' in dependencies ? dependencies.systemRoot : process.env.SystemRoot;
  if (!systemRoot || !/^[a-z]:[\\/]/i.test(systemRoot)) {
    fallback();
    return Promise.resolve({cleanupIncomplete: true, cleanupReason: 'system-root-unavailable'});
  }
  const executable = path.win32.join(systemRoot, 'System32', 'taskkill.exe');
  let helper: ChildProcess;
  try {
    helper = (dependencies.spawn ?? spawn)(executable, ['/PID', String(pid), '/T', '/F'],
      {shell: false, windowsHide: true, stdio: 'ignore'});
  } catch {
    fallback();
    return Promise.resolve({cleanupIncomplete: true, cleanupReason: 'taskkill-spawn-failed'});
  }
  return new Promise(resolve => {
    let result: ProcessCleanupResult = {};
    let settled = false;
    let helperExited = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = (closed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (grace !== undefined) clearTimeout(grace);
      helper.removeListener('error', onError);
      helper.removeListener('exit', onExit);
      helper.removeListener('close', onClose);
      if (!closed) guardLateErrors(helper);
      helper.unref();
      resolve(result);
    };
    const onExit = () => {helperExited = true;};
    const onError = () => {
      if (!result.cleanupIncomplete) result = {cleanupIncomplete: true, cleanupReason: 'taskkill-spawn-failed'};
      fallback();
    };
    const onClose = (code: number | null) => {
      if (!result.cleanupIncomplete && code !== 0) {
        result = {cleanupIncomplete: true, cleanupReason: 'taskkill-failed', cleanupExitCode: code};
      }
      fallback(); // Only after taskkill has had the opportunity to kill the tree.
      finish(true);
    };
    const deadline = setTimeout(() => {
      result = {...result, cleanupIncomplete: true, cleanupReason: result.cleanupReason ?? 'taskkill-timeout', cleanupTimedOut: true};
      fallback();
      grace = setTimeout(() => finish(false), 250);
      if (!helperExited) {try {helper.kill('SIGKILL');} catch {}}
    }, 750);
    helper.on('error', onError);
    helper.once('exit', onExit);
    helper.once('close', onClose);
  });
}
