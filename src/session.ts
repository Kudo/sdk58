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
 * - Our snippet calls `globalThis.__rnA11y.request(json)` (runtime/session.js),
 *   which prints one `{"type":"rn-a11y-tree-response",...}` line.
 * - The host exits (code 0) when stdin is closed.
 */

import {type ChildProcess, spawn} from 'node:child_process';
import readline from 'node:readline';

import {getHostBin, hostArgs} from './host.ts';
import type {ShadowNodeJSON, Step} from './schema.ts';
import {validateScript} from './script.ts';
import {convertShadowTree, convertStep} from './tree.ts';

const RESPONSE_TYPE = 'rn-a11y-tree-response';

type HostResponse = {
  id: unknown;
  ok: boolean;
  error?: string;
  ready?: boolean;
  quit?: boolean;
  step?: Step;
  tree?: ShadowNodeJSON;
  fallbacks?: string[];
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
  io: SessionIO;
}): Promise<number> {
  const {io} = options;
  const child: ChildProcess = spawn(
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
    {stdio: ['pipe', 'pipe', 'pipe']},
  );

  const stderrChunks: Buffer[] = [];
  child.stderr!.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
    if (options.verbose) process.stderr.write(chunk);
  });

  let current: Frame | null = null;
  let exited = false;
  const exitPromise = new Promise<number>(resolve => {
    child.on('close', code => {
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
      case 'console-log':
        io.log(`[app] ${message.message}`);
        break;
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
      const frame: Frame = {
        response: null,
        replError: null,
        resolve: () => {
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

  const convert = (response: HostResponse) => {
    const out: Record<string, unknown> = {id: response.id, ok: response.ok};
    if (response.error != null) out.error = response.error;
    if (response.step != null) out.step = convertStep(response.step);
    if (response.tree != null) out.tree = convertShadowTree(response.tree);
    if (response.fallbacks != null && response.fallbacks.length > 0) {
      out.fallbacks = response.fallbacks;
    }
    return out;
  };

  const finish = async (): Promise<number> => {
    child.stdin!.end();
    const code = await exitPromise;
    if (code !== 0) {
      io.log(`host exited with code ${code}`);
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (stderr && !options.verbose) io.log(stderr.trimEnd());
    }
    return code;
  };

  // Initial render.
  const start = await send({id: null, start: true});
  if (!start.ok) {
    writeLine({ready: false, error: start.error});
    await finish();
    return 1;
  }
  writeLine({ready: true, tree: start.tree ? convertShadowTree(start.tree) : null});

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
      writeLine({id: null, ok: false, error: `invalid JSON: ${(error as Error).message}`});
      continue;
    }
    const problem = validateRequest(request);
    if (problem != null) {
      writeLine({id: request?.id ?? null, ok: false, error: problem});
      continue;
    }
    const response = await send(request);
    writeLine(convert(response));
    if (request.quit === true) {
      quitSent = true;
      break;
    }
    if (exited) break;
  }
  lines.close();
  if (!exited && !quitSent) {
    // End of input without `quit` behaves like `quit`.
    await send({id: null, quit: true});
  }
  return finish();
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
