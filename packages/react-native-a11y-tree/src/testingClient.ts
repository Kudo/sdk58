import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
import type {SessionOutputLine, SessionResponse, TreeNode} from './schema.ts';
import type {ProjectConfig, PresetName} from './presets.ts';

export type RenderOptions = Omit<ProjectConfig, 'rules' | 'format'> & {
  projectRoot?: string;
  fixtures?: 'expo';
  timeout?: number;
};

type Pending = {resolve: (value: SessionResponse) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>};

export class TestSession {
  tree!: TreeNode;
  nodeTags: Record<string, number> = {};
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private stderr = '';
  private failure: Error | undefined;
  private exit: Promise<number | null>;
  private ready: Promise<void>;
  private readyReject!: (error: Error) => void;
  private closing = false;

  constructor(file: string | undefined, route: string | undefined, options: RenderOptions) {
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const cli = path.join(packageRoot, import.meta.url.endsWith('.ts') ? 'src/cli.ts' : 'dist/rn-a11y-tree.js');
    const root = path.resolve(options.projectRoot ?? process.cwd());
    const args = [...(cli.endsWith('.ts') ? ['--experimental-strip-types'] : []), cli, 'session', ...(file ? [path.resolve(root, file)] : ['--router', '--route', route ?? '/']), '--project-root', root, '--quiet'];
    const config = path.join(root, 'a11y-tree.json');
    let configuredDevice = false;
    if (fs.existsSync(config)) {
      try {const configured = JSON.parse(fs.readFileSync(config, 'utf8')); configuredDevice = !!(configured?.preset || configured?.platform);}
      catch { /* The CLI reports invalid project configuration. */ }
    }
    if (!options.preset && !options.platform && !configuredDevice) args.push('--preset', 'android-phone' satisfies PresetName);
    for (const [key, value] of Object.entries(options)) {
      if (value === undefined || key === 'projectRoot') continue;
      const flag = '--' + key.replace(/[A-Z]/g, char => '-' + char.toLowerCase());
      if (Array.isArray(value)) for (const item of value) args.push(flag, String(item));
      else if (key === 'safeAreaInsets') {
        const insets = value as {top: number; left: number; right: number; bottom: number};
        args.push(flag, `${insets.top},${insets.left},${insets.right},${insets.bottom}`);
      } else if (typeof value === 'boolean') args.push(value ? flag : '--no-' + flag.slice(2));
      else args.push(flag, key === 'setup' || key === 'metroConfig' ? path.resolve(root, String(value)) : String(value));
    }
    // Expo Router's Metro transform uses production discovery; Vitest sets NODE_ENV=test.
    this.child = spawn(process.execPath, args, {cwd: root, env: {...process.env, NODE_ENV: 'production'}, stdio: 'pipe'});
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + String(chunk)).slice(-65536); });
    this.child.stdin.on('error', error => this.fail(error));
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    this.ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    this.readyReject = readyReject;
    const timer = setTimeout(() => {
      const error = new Error('Timed out starting the a11y-tree session');
      this.fail(error); readyReject(error); this.child.kill('SIGTERM');
    }, 120_000);
    const lines = readline.createInterface({input: this.child.stdout});
    lines.on('line', line => {
      let message: SessionOutputLine;
      try { message = JSON.parse(line); }
      catch { this.fail(new Error(`Invalid session output: ${line.slice(0,200)}`)); return; }
      if ('ready' in message) {
        clearTimeout(timer);
        if (!message.ready) {
          const error = new Error(`${message.error.code}: ${message.error.message}`);
          this.fail(error); readyReject(error);
        } else {
          this.tree = message.tree as TreeNode;
          readyResolve();
        }
      } else {
        if (!message.ok && message.id === null) this.fail(new Error(`${message.error?.code}: ${message.error?.message}`));
        const pending = this.pending.get(message.id as number);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id as number);
        if (!message.ok) pending.reject(new Error(`${message.error?.code}: ${message.error?.message}`));
        else pending.resolve(message);
      }
    });
    this.child.on('error', error => {clearTimeout(timer); this.fail(error); readyReject(error);});
    this.exit = new Promise(resolve => this.child.on('close', code => {
      clearTimeout(timer); lines.close();
      if (!this.closing || code !== 0) this.fail(new Error(`a11y-tree session exited (${code})\n${this.stderr}`));
      readyReject(this.failure ?? new Error(`Session closed before ready\n${this.stderr}`));
      for (const pending of this.pending.values()) {clearTimeout(pending.timer); pending.reject(this.failure ?? new Error('Session closed'));}
      this.pending.clear(); resolve(code);
    }));
  }

  private fail(error: Error) {
    this.failure ??= error;
    this.readyReject?.(error);
    for (const pending of this.pending.values()) {clearTimeout(pending.timer); pending.reject(error);}
    this.pending.clear();
  }

  async start() { await this.ready; if (this.failure) throw this.failure; await this.refresh(); }

  async request(request: Record<string, unknown>): Promise<SessionResponse> {
    if (this.failure) throw this.failure;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Timed out waiting for an a11y-tree response'));
        this.child.kill('SIGTERM');
      }, 35_000);
      this.pending.set(id, {resolve, reject, timer});
      this.child.stdin.write(JSON.stringify({...request, id}) + '\n');
    });
  }

  async refresh() {
    const response = await this.request({tree: true, identities: true});
    this.tree = response.tree as TreeNode;
    this.nodeTags = response.nodeTags ?? {};
  }

  async close() {
    if (this.closing) return;
    this.closing = true;
    const kill = setTimeout(() => this.child.kill('SIGTERM'), 5000);
    const force = setTimeout(() => this.child.kill('SIGKILL'), 7500);
    try {
      if (!this.failure && this.child.exitCode === null) await this.request({quit: true});
    } finally {
      this.child.stdin.end();
      await this.exit;
      clearTimeout(kill); clearTimeout(force);
    }
    if (this.failure) throw this.failure;
  }
}
