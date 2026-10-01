/**
 * `rn-a11y-tree session`: drives a host started in Fantom's `--interactive`
 * mode over JSON lines on our stdin/stdout.
 *
 * Host protocol (tester/src/TesterAppDelegate.cpp `runInteractiveLoop`):
 * - The host evaluates the bundle, then reads frames from stdin: a line with
 *   the byte length of the code, then exactly that many bytes of JS.
 * - After each frame it prints `{"type":"repl-eval-complete","id":n}` on
 *   stdout. A thrown JS error prints `{"type":"repl-error","message","stack"}`
 *   before that. Console output is `{"type":"console-log",...}`.
 * - Our snippet calls `globalThis.__rnA11y.request(json)` (runtime/session.ts),
 *   which prints one `{"type":"rn-a11y-tree-response",...}` line.
 * - The host exits (code 0) when stdin is closed.
 */

import type {ChildProcess} from 'node:child_process';
import readline from 'node:readline';

import {appendHostStderr, checkHostInfo, getHostBin, type HostInfo, hostArgs, hostEnv, spawnHost} from './host.ts';
import type {HostRuntimeInfo, SessionTreeOptions, ShadowNodeJSON, Step} from './schema.ts';
import {validateScript} from './script.ts';
import {diffTrees} from './diff.ts';
import {type CliError, type ErrorCode, EXIT_CODES, type LogEntry, logEntry, stepErrorCode} from './errors.ts';
import {type Format, FORMATS, formatRender, parseSelector} from './format.ts';
import type {TreeNode} from './schema.ts';
import {convertShadowTree, convertStep} from './tree.ts';

const RESPONSE_TYPE = 'rn-a11y-tree-response';
export const DEFAULT_TIMEOUT_MS = 30_000;

type HostResponse = {
  id: unknown;
  ok: boolean;
  error?: string;
  ready?: boolean;
  quit?: boolean;
  step?: Step;
  tree?: ShadowNodeJSON;
  fallbacks?: string[];
  capabilities?: string[];
  timings?: Record<string, number | undefined>;
  diffTrees?: ShadowNodeJSON[];
  hostInfo?: HostRuntimeInfo | null;
};

type Frame = {
  response: HostResponse | null;
  replError: {message: string; stack?: string} | null;
  resolve: () => void;
};

export type SessionIO = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  log: (line: string) => void;
};

/** Starts the host and serves requests until `quit` or end of input. Returns the exit code. */
export async function runSession(options: {
  bundlePath: string;
  windowWidth: number;
  windowHeight: number;
  verbose?: boolean;
  /** Per-request timeout in ms; on timeout the host is killed and the session ends with code 1. */
  timeoutMs?: number;
  /** Print startup timings and per-request latency as JSON on stderr. */
  timing?: boolean;
  /** Do not echo app console output as [app] lines (it is in each response's `logs`). */
  quiet?: boolean;
  /** The host found by ensureHost() (reported in the ready line). */
  host?: HostInfo | null;
  /** Output options for the ready tree, and defaults for `tree` / `snapshot` responses (a request's own fields win). */
  treeDefaults?: SessionTreeOptions;
  /** Time zone of the host (`TZ`); default UTC. */
  tz?: string;
  io: SessionIO;
}): Promise<number> {
  const treeDefaults: Record<string, unknown> = {...options.treeDefaults};
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const {io} = options;
  const spawnedAt = performance.now();
  const child: ChildProcess = spawnHost(
    getHostBin(),
    [
      '--interactive',
      ...hostArgs({
        bundlePath: options.bundlePath,
        windowWidth: options.windowWidth,
        windowHeight: options.windowHeight,
        verbose: options.verbose,
      }),
    ],
    {stdio: ['pipe', 'pipe', 'pipe'], env: hostEnv(options.tz)},
  );

  const stderrChunks: Buffer[] = [];
  child.stderr!.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
    if (options.verbose) process.stderr.write(chunk);
  });

  let current: Frame | null = null;
  // App console output since the last response.
  let pendingLogs: LogEntry[] = [];
  const takeLogs = () => {
    const logs = pendingLogs;
    pendingLogs = [];
    return logs;
  };
  let exited = false;
  const exitPromise = new Promise<number>(resolve => {
    child.on('close', code => {
      appendHostStderr(getHostBin(), Buffer.concat(stderrChunks).toString('utf8'));
      exited = true;
      current?.resolve();
      resolve(code ?? 1);
    });
  });
  child.on('error', error => {
    io.log(`host failed to start: ${error.message}`);
  });

  readline.createInterface({input: child.stdout!}).on('line', rawLine => {
    const line = rawLine.trim();
    if (!line) return;
    let message: {type?: string; [key: string]: unknown};
    try {
      message = JSON.parse(line);
    } catch {
      io.log(`[host] ${line}`);
      return;
    }
    switch (message.type) {
      case RESPONSE_TYPE:
        if (current) current.response = message as unknown as HostResponse;
        break;
      case 'repl-error':
        if (current) {
          current.replError = {
            message: String(message.message),
            stack: message.stack as string | undefined,
          };
        }
        break;
      case 'repl-eval-complete': {
        const frame = current;
        current = null;
        frame?.resolve();
        break;
      }
      case 'console-log': {
        const entry = logEntry(String(message.level ?? 'info'), String(message.message));
        pendingLogs.push(entry);
        if (!options.quiet || entry.message.startsWith('[NATIVE_COMPONENT_FALLBACK] ')) io.log(`[app] ${entry.message}`);
        break;
      }
      default:
        if (options.verbose) io.log(`[host] ${line}`);
    }
  });

  /** Sends one request to the runtime and waits for the frame to complete. */
  function send(request: Record<string, unknown>): Promise<HostResponse> {
    if (exited) {
      return Promise.resolve({id: request.id, ok: false, error: 'host has exited'});
    }
    return new Promise(resolve => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        timedOut = true;
        current = null;
        child.kill('SIGKILL');
        resolve({id: request.id, ok: false, error: 'timeout'});
      }, timeoutMs);
      const frame: Frame = {
        response: null,
        replError: null,
        resolve: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (frame.response) {
            resolve(frame.response);
          } else if (frame.replError) {
            resolve({id: request.id, ok: false, error: frame.replError.message});
          } else {
            resolve({
              id: request.id,
              ok: false,
              error: exited ? 'host exited while handling the request' : 'no response from the runtime',
            });
          }
        },
      };
      current = frame;
      const arg = JSON.stringify(JSON.stringify(request));
      const code =
        `globalThis.__rnA11y != null ? globalThis.__rnA11y.request(${arg}) : ` +
        `(() => { throw globalThis.__rnA11ySetupError ?? new Error('rn-a11y-tree session runtime is not installed'); })();\n`;
      const bytes = Buffer.from(code, 'utf8');
      child.stdin!.write(`${bytes.length}\n`);
      child.stdin!.write(bytes);
    });
  }

  const writeLine = (value: unknown) => {
    io.output.write(JSON.stringify(value) + '\n');
  };

  const convert = (response: HostResponse, request: Record<string, unknown>) => {
    const out: Record<string, unknown> = {id: response.id, ok: response.ok};
    const step = response.step != null ? convertStep(response.step) : null;
    if (response.error != null) {
      out.error =
        step?.error != null && typeof step.error === 'object'
          ? step.error
          : {code: responseErrorCode(response.error), message: response.error};
    }
    if (step != null) out.step = step;
    if (response.tree != null) {
      out.tree = formatSessionTree(convertShadowTree(response.tree), {...treeDefaults, ...pickOutputKeys(request)});
    }
    if (response.diffTrees != null) {
      const [before, after] = response.diffTrees.map(convertShadowTree);
      out.diff = diffTrees(before, after);
    }
    if (response.fallbacks != null && response.fallbacks.length > 0) {
      out.fallbacks = response.fallbacks;
    }
    const logs = takeLogs();
    if (logs.length > 0) out.logs = logs;
    return out;
  };

  const finish = async (): Promise<number> => {
    child.stdin!.end();
    const code = await exitPromise;
    if (timedOut) {
      io.log(`request timed out after ${timeoutMs} ms; host killed`);
      return EXIT_CODES.TIMEOUT;
    }
    if (code !== 0) {
      io.log(`host exited with code ${code}`);
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (stderr && !options.verbose) io.log(stderr.trimEnd());
      return EXIT_CODES.HOST_CRASHED;
    }
    return 0;
  };

  // Initial render.
  const start = await send({id: null, start: true});
  if (timedOut) {
    writeLine({ready: false, error: {code: 'TIMEOUT', message: 'timeout'}});
    return finish();
  }
  if (!start.ok) {
    const code = exited ? 'HOST_CRASHED' : 'APP_THREW';
    const logs = takeLogs();
    writeLine({ready: false, error: {code, message: start.error}, ...(logs.length > 0 ? {logs} : {})});
    await finish();
    return EXIT_CODES[code];
  }
  try {
    checkHostInfo(start.hostInfo);
  } catch (error) {
    const cliError = error as CliError;
    writeLine({ready: false, error: cliError.toJSON()});
    await finish();
    return EXIT_CODES[cliError.code];
  }
  if (options.timing) {
    const toReady = Math.round((performance.now() - spawnedAt) * 1000) / 1000;
    const js = start.timings;
    io.log(
      `rn-a11y-tree timing: ${JSON.stringify({
        hostSpawnToReadyMs: toReady,
        hostStartupMs:
          js?.jsTotalMs != null ? Math.round((toReady - js.jsTotalMs) * 1000) / 1000 : undefined,
        js,
      })}`,
    );
  }
  const readyLogs = takeLogs();
  const host = options.host;
  writeLine({
    ready: true,
    tree: start.tree ? formatSessionTree(convertShadowTree(start.tree), treeDefaults) : null,
    capabilities: start.capabilities ?? [],
    ...(start.hostInfo != null ? {hostInfo: start.hostInfo} : {}),
    ...(host != null
      ? {
          host: {
            source: host.source,
            ...(host.version != null ? {version: host.version} : {}),
            ...(host.protocolVersion != null ? {protocolVersion: host.protocolVersion} : {}),
          },
        }
      : {}),
    ...(readyLogs.length > 0 ? {logs: readyLogs} : {}),
  });

  // Requests, one at a time, in order.
  let quitSent = false;
  const lines = readline.createInterface({input: io.input});
  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    let request: Record<string, unknown>;
    try {
      request = JSON.parse(line);
    } catch (error) {
      writeLine({id: null, ok: false, error: {code: 'USAGE', message: `invalid JSON: ${(error as Error).message}`}});
      continue;
    }
    const problem = validateRequest(request);
    if (problem != null) {
      writeLine({id: request?.id ?? null, ok: false, error: {code: 'USAGE', message: problem}});
      continue;
    }
    const requestStart = performance.now();
    const response = await send(request);
    writeLine(convert(response, request));
    if (options.timing) {
      io.log(
        `rn-a11y-tree timing: ${JSON.stringify({id: request.id, requestMs: Math.round((performance.now() - requestStart) * 1000) / 1000})}`,
      );
    }
    if (timedOut) break;
    if (request.quit === true) {
      quitSent = true;
      break;
    }
    if (exited) break;
  }
  lines.close();
  if (!exited && !quitSent && !timedOut) {
    // End of input without `quit` behaves like `quit`.
    await send({id: null, quit: true});
  }
  return finish();
}

/**
 * Optional output fields on `tree` and `snapshot` requests: `format`
 * (json | compact | text | ndjson), `select` (string or list), `depth`,
 * `subtree`, `style`. Text and ndjson trees are returned as a string.
 */
function formatSessionTree(tree: TreeNode, request: Record<string, unknown>): unknown {
  const format = (request.format as Format | undefined) ?? 'json';
  const select =
    typeof request.select === 'string' ? [request.select] : (request.select as string[] | undefined);
  const options = {
    format,
    select,
    depth: request.depth as number | undefined,
    subtree: request.subtree as string | undefined,
    style: request.style === true,
  };
  if (format === 'json' && select == null && options.depth == null && options.subtree == null) {
    return tree;
  }
  const viewport = {width: 0, height: 0};
  const text = formatRender({viewport, source: 'shadowTree', root: tree}, options);
  if (format === 'text' || format === 'ndjson') return text;
  const parsed = JSON.parse(text) as {root?: unknown; matches?: unknown};
  return parsed.root ?? parsed.matches;
}

const OUTPUT_KEYS = ['format', 'select', 'depth', 'subtree', 'style'];

function pickOutputKeys(request: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(OUTPUT_KEYS.filter(key => key in request).map(key => [key, request[key]]));
}

function responseErrorCode(message: string): ErrorCode {
  if (message === 'timeout') return 'TIMEOUT';
  if (/host (has )?exited/.test(message)) return 'HOST_CRASHED';
  if (/Session is not started|Unknown request/.test(message)) return 'USAGE';
  return stepErrorCode(message);
}

/** Returns an error message, or null if the request is valid. */
export function validateRequest(request: unknown): string | null {
  if (typeof request !== 'object' || request == null || Array.isArray(request)) {
    return 'request must be a JSON object';
  }
  const r = request as Record<string, unknown>;
  if (!('id' in r)) return 'request needs an "id"';
  const kinds = ['action', 'tree', 'quit'].filter(k => k in r);
  if (kinds.length !== 1) {
    return 'request needs exactly one of "action", "tree" or "quit"';
  }
  if ('diff' in r && (kinds[0] !== 'action' || typeof r.diff !== 'boolean')) {
    return '"diff" must be true or false, on action requests';
  }
  if ('format' in r && !FORMATS.includes(r.format as Format)) {
    return `"format" must be one of: ${FORMATS.join(', ')}`;
  }
  for (const key of OUTPUT_KEYS) {
    if (key in r && kinds[0] === 'quit') return `"${key}" is not allowed on quit`;
  }
  if (typeof r.select === 'string' || Array.isArray(r.select)) {
    try {
      for (const sel of typeof r.select === 'string' ? [r.select] : (r.select as string[])) parseSelector(sel);
    } catch (error) {
      return (error as Error).message;
    }
  }
  if (kinds[0] === 'action') {
    try {
      validateScript([r.action]);
    } catch (error) {
      return (error as Error).message.replace(/^step 0: /, '');
    }
  } else if (r[kinds[0]] !== true) {
    return `"${kinds[0]}" must be true`;
  }
  return null;
}
