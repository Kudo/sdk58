import {inspectCompatibility} from './compatibility.ts';
import {inspectDoctor} from './doctor.ts';
import {collectDiagnostics, fidelityError, type FidelityOptions} from './diagnostics.ts';
import fs from 'node:fs';
import path from 'node:path';

import {Command, CommanderError, InvalidArgumentError} from 'commander';

import {bundle, type BundleResult, findProjectRoot, type HostConfig, PACKAGE_ROOT, type TapMode} from './bundle.ts';
import {loadProjectConfig, PRESET_NAMES, resolveSettings} from './presets.ts';
import {type Format, type FormatOptions, FORMATS, formatRender, formatRun} from './format.ts';
import {type BytecodeMode, discardBytecode} from './bundleCache.ts';
import {addStepViolations, type CheckResult, checkText, checkTree, readRulesFile, type Rules} from './check.ts';
import {CliError, EXIT_CODES, type LogEntry, usage} from './errors.ts';
import {checkHostInfo, ensureHost, type HostTiming, runHost} from './host.ts';
import type {HostPayload, HostRunPayload, HostRuntimeInfo, SessionTreeOptions, Step} from './schema.ts';
import {ScriptError, scriptHelp, validateScript} from './script.ts';
import {DEFAULT_TIMEOUT_MS, runSession, validateRequest} from './session.ts';
import {toRenderResult, toRunResult} from './tree.ts';

// stdout is reserved for the JSON result. Metro and @expo/metro-config log
// with console.log/info (e.g. "Could not resolve react-native!"), so send
// those to stderr.
console.log = console.error;
console.info = console.error;

function positiveNumber(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new InvalidArgumentError('Must be a positive number.');
  }
  return n;
}

type HostConfigOptions = {
  mounted?: boolean;
  width?: number;
  height?: number;
  scale?: number;
  fontScale?: number;
  headerHeight?: number;
  safeAreaInsets?: HostConfig['safeAreaInsets'];
};

type OutputOptions = {
  format?: string;
  select?: string[];
  depth?: number;
  subtree?: string;
  style?: boolean;
};

function formatOptions(options: OutputOptions): FormatOptions {
  const format = (options.format ?? 'json') as Format;
  if (!FORMATS.includes(format)) {
    throw usage(`--format must be one of: ${FORMATS.join(', ')}`);
  }
  return {
    format,
    select: options.select,
    depth: options.depth,
    subtree: options.subtree,
    style: options.style,
  };
}

/** --quiet is the default when stdout is not a terminal (agents, pipes). */
function isQuiet(options: {quiet?: boolean}): boolean {
  return options.quiet ?? !process.stdout.isTTY;
}

/** The MSVC runtime of the Windows host reads only POSIX TZ values (`UTC`, `JST-9`, `PST8PDT`), not IANA names. */
function warnTimeZone(options: {tz?: string; quiet?: boolean}): void {
  if (process.platform === 'win32' && options.tz?.includes('/') && !isQuiet(options)) {
    process.stderr.write('rn-a11y-tree: warning: on Windows --tz needs a POSIX TZ such as JST-9 or PST8PDT\n');
  }
}

type RenderOptions = FidelityOptions & HostConfigOptions & OutputOptions & {
  quiet?: boolean;
  timing?: boolean;
  resetCache?: boolean;
  /** --no-cache sets false. */
  cache?: boolean;
  bytecode?: string;
  setup?: string;
  projectRoot?: string;
  metroConfig?: string;
  timeout?: number;
  width: number;
  height: number;
  platform?: string;
  out?: string;
  keepBundle: boolean;
  bundleOnly: boolean;
  dev: boolean;
  debugProps: boolean;
  verbose: boolean;
  /** --tz: time zone of the host (default UTC). */
  tz?: string;
};

function write(text: string, out: string | undefined) {
  if (out) {
    fs.writeFileSync(out, text);
  } else {
    process.stdout.write(text);
  }
}

const PLATFORM_REQUIRED_MESSAGE = `--platform <name> is required (or --preset, or "platform"/"preset" in a11y-tree.json). Known values: android, ios, a11ytree. Any Metro platform name is accepted.
Note: React Native core components branch on Platform.OS (e.g. TextInput, Switch), so use android or ios for them to render.`;

type RunOptions = RenderOptions & {script?: string; tapMode: string; diff?: boolean};

const TAP_MODES: TapMode[] = ['touch', 'click', 'both'];

function nonNegativeNumber(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new InvalidArgumentError('Must be a number >= 0.');
  }
  return n;
}

function parseInsets(value: string): NonNullable<HostConfig['safeAreaInsets']> {
  const parts = value.split(',').map(p => Number(p.trim()));
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n) || n < 0)) {
    throw new InvalidArgumentError('Expected top,left,right,bottom (numbers >= 0), e.g. 47,0,0,34.');
  }
  const [top, left, right, bottom] = parts;
  return {top, left, right, bottom};
}

/**
 * Host settings for the first render. iOS uses a 44 dp navigation bar; the
 * host default (56 dp) is the Android toolbar.
 */
function hostConfigFor(platform: string, options: HostConfigOptions): HostConfig {
  const config: HostConfig = {};
  if (options.mounted === false) config.mounted = false;
  const headerHeight = options.headerHeight ?? (platform === 'ios' ? 44 : undefined);
  if (headerHeight != null) config.headerHeight = headerHeight;
  if (options.safeAreaInsets != null) config.safeAreaInsets = options.safeAreaInsets;
  if (options.width != null && options.height != null) {
    config.deviceMetrics = {
      width: options.width,
      height: options.height,
      scale: options.scale ?? DEFAULT_SCALE,
      fontScale: options.fontScale ?? 1,
    };
  }
  return config;
}

/** Device pixel ratio without a preset or --scale (phone-like). */
const DEFAULT_SCALE = 3;

function requirePlatform(platform: string | undefined): string {
  if (platform == null || platform === '') {
    throw usage(PLATFORM_REQUIRED_MESSAGE, 'Pass --platform android (or ios, a11ytree), or a --preset.');
  }
  return platform;
}

function readScript(scriptPath: string | undefined) {
  if (scriptPath == null || scriptPath === '') {
    throw usage('--script <json> is required');
  }
  // A value that starts with `[` or `{` is the script itself (inline JSON).
  const inline = /^\s*[[{]/.test(scriptPath);
  let text: string;
  try {
    text = inline ? scriptPath : fs.readFileSync(scriptPath, 'utf8');
  } catch (error) {
    throw usage(`cannot read ${scriptPath}: ${(error as Error).message}`);
  }
  if (inline) scriptPath = '--script';
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw usage(`${scriptPath} is not valid JSON: ${(error as Error).message}`);
  }
  try {
    return validateScript(json);
  } catch (error) {
    throw usage(`${scriptPath}: ${(error as Error).message}`);
  }
}

/**
 * Bundles the app (with an optional script), runs the host and returns the
 * payload. Returns undefined for --bundle-only.
 */
/** Phase timings for `--timing` (ms, performance.now() in the CLI). */
type Timing = {
  bundleCache?: 'hit' | 'miss' | 'off';
  bytecode?: boolean;
  metroMs?: number;
  bundleBytes?: number;
  hostSpawnToResultMs?: number;
  hostSpawnToExitMs?: number;
  hostStartupMs?: number;
  js?: Record<string, number | undefined>;
  convertMs?: number;
  outputBytes?: number;
  totalMs?: number;
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

const BYTECODE_MODES: BytecodeMode[] = ['auto', 'on', 'off'];

function bytecodeMode(value: string | undefined): BytecodeMode {
  const mode = (value ?? 'auto') as BytecodeMode;
  if (!BYTECODE_MODES.includes(mode)) {
    throw usage(`--bytecode must be one of: ${BYTECODE_MODES.join(', ')}`);
  }
  return mode;
}

/** Metro errors become BUNDLE_FAILED; usage errors pass through. */
async function bundleOrFail(options: Parameters<typeof bundle>[0]): Promise<BundleResult> {
  try {
    return await bundle(options);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('BUNDLE_FAILED', (error as Error).message, {
      hint: 'Fix the error in the app code or its imports; see the message for the file and line.',
    });
  }
}

function describeBundle(result: BundleResult): string {
  const notes = [
    result.cache === 'hit' ? 'cached' : result.cache === 'miss' ? 'built' : 'not cached',
    result.bytecode ? 'bytecode' : 'js',
  ];
  return `Bundle: ${result.bundlePath} (${result.sizeBytes} bytes, ${notes.join(', ')})\n`;
}

function printTiming(timing: Timing) {
  // performance.now() counts from process start, so this includes Node startup.
  timing.totalMs = round3(performance.now());
  process.stderr.write(`rn-a11y-tree timing: ${JSON.stringify(timing)}\n`);
}

function dependencyDiagnostics(file: string, options: RenderOptions, host: import('./host.ts').HostInfo): LogEntry[] {
  const report = inspectCompatibility(options.projectRoot ?? findProjectRoot(file), host);
  const mismatch = report.issues.find(issue => issue.code === 'RN_VERSION_MISMATCH' && issue.severity === 'error');
  if (mismatch) throw new CliError('HOST_INCOMPATIBLE', mismatch.message, {details: {compatibility: report}});
  const logs: LogEntry[] = report.issues.map(issue => ({level: 'warn', message: `[DEPENDENCY_COMPATIBILITY] ${issue.package}: ${issue.message}`}));
  const root = options.projectRoot ?? findProjectRoot(file);
  const ignored = ['metro.config.js', 'metro.config.cjs', 'metro.config.mjs', 'metro.config.ts'].find(name => fs.existsSync(path.join(root, name)));
  if (!options.metroConfig && ignored) logs.push({level: 'warn', message: `[BUILD_CONFIGURATION] metro-config: ${ignored} is not loaded. Use --metro-config to opt in to supported resolver/transformer settings; unsupported native CSS or serializer integrations are rejected.`});
  return logs;
}

async function execute<T>(
  file: string,
  options: RenderOptions,
  extra: {script?: unknown[]; tapMode?: TapMode; runOptions?: {diff?: boolean}},
  timing?: Timing,
  logs?: LogEntry[],
): Promise<T | undefined> {
  const platform = requirePlatform(options.platform);
  if (!options.bundleOnly) {
    // Fail (or download) before spending time on Metro.
    const host = await ensureHost({quiet: isQuiet(options), verbose: options.verbose});
    logs?.push(...dependencyDiagnostics(file, options, host));
    warnTimeZone(options);
  }
  const metroStart = performance.now();
  const result = await bundleOrFail({
    appPath: file,
    setupPath: options.setup,
    projectRoot: options.projectRoot,
    metroConfigPath: options.metroConfig,
    viewportWidth: options.width,
    viewportHeight: options.height,
    platform,
    dev: options.dev,
    includeDebugProps: options.debugProps,
    verbose: options.verbose,
    hostConfig: hostConfigFor(platform, options),
    resetCache: options.resetCache,
    cache: options.cache,
    bytecode: bytecodeMode(options.bytecode),
    ...extra,
  });
  if (timing) {
    timing.bundleCache = result.cache;
    timing.bytecode = result.bytecode;
    timing.metroMs = round3(performance.now() - metroStart);
    timing.bundleBytes = result.sizeBytes;
  }
  const cleanUp = () => {
    if (result.workDir != null && !options.keepBundle && !options.bundleOnly) {
      fs.rmSync(result.workDir, {recursive: true, force: true});
    }
  };

  if (options.keepBundle || options.bundleOnly || options.verbose) {
    process.stderr.write(describeBundle(result));
  }
  if (options.bundleOnly) {
    return undefined;
  }

  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  const hostDeadline = performance.now() + (options.timeout ?? 30_000);
  const hostTiming: HostTiming = {};
  const hostOptions = {
    signal: cancellation.signal,
    windowWidth: options.width,
    windowHeight: options.height,
    verbose: options.verbose,
    timing: hostTiming,
    logs,
    quiet: isQuiet(options),
    tz: options.tz,
  };
  const attempt = (bundlePath: string) => {
    const remaining = Math.ceil(hostDeadline - performance.now());
    if (remaining <= 0) throw new CliError('TIMEOUT', 'Host execution deadline exceeded before retry.');
    return runHost<T>({...hostOptions, bundlePath, timeoutMs: remaining});
  };
  try {
    let payload: T;
    try {
      payload = await attempt(result.bundlePath);
    } catch (error) {
      // A bytecode file the host cannot load (e.g. a Hermes bytecode version
      // mismatch) makes the host fail before any JS runs: drop it and use JS.
      const noRetry = cancellation.signal.aborted || (error instanceof CliError && (error.code === 'APP_THREW' || error.code === 'TIMEOUT' || error.details?.outputLimit === true));
      if (!result.bytecode || noRetry || result.cacheDir == null) throw error;
      discardBytecode(result.cacheDir);
      process.stderr.write('rn-a11y-tree: warning: the host could not load the bytecode bundle; using JS\n');
      if (timing) timing.bytecode = false;
      payload = await attempt(result.jsBundlePath);
    }
    checkHostInfo((payload as {hostInfo?: HostRuntimeInfo | null}).hostInfo, {verbose: options.verbose});
    if (timing && hostTiming.spawn != null) {
      const js = (payload as {timings?: Record<string, number | undefined>}).timings;
      if (hostTiming.result != null) {
        timing.hostSpawnToResultMs = round3(hostTiming.result - hostTiming.spawn);
        if (js?.jsTotalMs != null) {
          // Host process start until the bundle starts evaluating (Hermes,
          // Fabric, TurboModules), plus reading the bundle.
          timing.hostStartupMs = round3(timing.hostSpawnToResultMs - js.jsTotalMs);
        }
      }
      if (hostTiming.exit != null) {
        timing.hostSpawnToExitMs = round3(hostTiming.exit - hostTiming.spawn);
      }
      timing.js = js;
    }
    return payload;
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    cleanUp();
  }
}

/**
 * Fills platform, viewport, insets, header height, tap mode and format from
 * the command line, a11y-tree.json and the preset, then built-in defaults.
 */
function applySettings(file: string, options: RenderOptions & {tapMode?: string; preset?: string}) {
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : findProjectRoot(file);
  if (!fs.existsSync(path.join(projectRoot, 'package.json'))) throw usage(`Project root must contain package.json: ${projectRoot}`, 'Use --project-root <app-directory> for a shared component, or run from an app with installed dependencies.');
  options.projectRoot = projectRoot;
  options.metroConfig = options.metroConfig ? path.resolve(options.metroConfig) : undefined;
  const config = loadProjectConfig(projectRoot);
  options.metroConfig ??= config?.metroConfig ? path.resolve(projectRoot, config.metroConfig) : undefined;
  applyConfig(options, config);
  options.setup = options.setup != null ? path.resolve(options.setup) :
    config?.setup != null ? path.resolve(projectRoot, config.setup) : undefined;
  return config;
}

function applyConfig(
  options: RenderOptions & {tapMode?: string; preset?: string},
  config: ReturnType<typeof loadProjectConfig>,
) {
  const resolved = resolveSettings(
    {
      preset: options.preset,
      platform: options.platform,
      width: options.width,
      height: options.height,
      safeAreaInsets: options.safeAreaInsets,
      headerHeight: options.headerHeight,
      scale: options.scale,
      fontScale: options.fontScale,
      tapMode: options.tapMode,
      format: options.format,
    },
    config,
  );
  options.platform = resolved.platform;
  options.width = resolved.width ?? 390;
  options.height = resolved.height ?? 844;
  options.safeAreaInsets = resolved.safeAreaInsets;
  options.headerHeight = resolved.headerHeight;
  options.scale = resolved.scale;
  options.fontScale = resolved.fontScale;
  options.tapMode = resolved.tapMode ?? 'touch';
  options.format = resolved.format ?? 'json';
  options.failOnFallback ??= config?.failOnFallback;
  options.allowFallback ??= config?.allowFallback;
}

async function render(file: string, options: RenderOptions) {
  applySettings(file, options);
  const output = formatOptions(options);
  const timing: Timing | undefined = options.timing ? {} : undefined;
  const logs: LogEntry[] = [];
  const payload = await execute<HostPayload>(file, options, {}, timing, logs);
  if (payload) {
    const convertStart = performance.now();
    const result = toRenderResult(payload);
    if (logs.length > 0) result.logs = logs;
    result.diagnostics = collectDiagnostics(logs);
    const policyError = fidelityError(result.diagnostics, options);
    if (policyError) throw policyError;
    const text = formatRender(result, output);
    if (timing) {
      timing.convertMs = round3(performance.now() - convertStart);
      timing.outputBytes = Buffer.byteLength(text);
    }
    write(text, options.out);
  }
  if (timing) printTiming(timing);
}

async function run(file: string, options: RunOptions) {
  applySettings(file, options);
  requirePlatform(options.platform);
  if (!TAP_MODES.includes(options.tapMode as TapMode)) {
    throw usage(`--tap-mode must be one of: ${TAP_MODES.join(', ')}`);
  }
  // Validate before bundling.
  const output = formatOptions(options);
  const script = readScript(options.script);
  const timing: Timing | undefined = options.timing ? {} : undefined;
  const logs: LogEntry[] = [];
  const payload = await execute<HostRunPayload>(
    file,
    options,
    {script, tapMode: options.tapMode as TapMode, runOptions: options.diff ? {diff: true} : undefined},
    timing,
    logs,
  );
  if (payload) {
    const fallbacks = [
      ...new Set([...(payload.fallbacks ?? []), ...describeFallbacks(payload.steps)]),
    ].sort();
    if (fallbacks.length > 0 && !isQuiet(options)) {
      process.stderr.write(
        `rn-a11y-tree: warning: JS fallbacks used because the host lacks native methods: ${fallbacks.join(', ')}\n`,
      );
    }
    const convertStart = performance.now();
    const result = toRunResult(payload);
    if (logs.length > 0) result.logs = logs;
    result.diagnostics = collectDiagnostics(logs, fallbacks);
    const policyError = fidelityError(result.diagnostics, options);
    if (policyError) throw policyError;
    const text = formatRun(result, output);
    if (timing) {
      timing.convertMs = round3(performance.now() - convertStart);
      timing.outputBytes = Buffer.byteLength(text);
    }
    write(text, options.out);
  }
  if (timing) printTiming(timing);
}

const SCHEMA_DIR = path.join(PACKAGE_ROOT, 'schema');

/** `schema [name]`: prints schema/<name>.json, or lists the schemas. */
function printSchema(name: string | undefined) {
  const names = fs
    .readdirSync(SCHEMA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -'.json'.length))
    .sort();
  if (name == null) {
    for (const n of names) {
      const {description} = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, `${n}.json`), 'utf8')) as {description?: string};
      process.stdout.write(`${n}\t${description ?? ''}\n`);
    }
    return;
  }
  if (!names.includes(name)) throw usage(`unknown schema "${name}" (one of: ${names.join(', ')})`);
  process.stdout.write(fs.readFileSync(path.join(SCHEMA_DIR, `${name}.json`), 'utf8'));
}

async function session(file: string, options: RunOptions) {
  // Only the command line sets the session's tree output (not `format` in a11y-tree.json).
  const treeDefaults: SessionTreeOptions = {
    ...(options.format != null ? {format: options.format as Format} : {}),
    ...(options.select != null && options.select.length > 0 ? {select: options.select} : {}),
    ...(options.depth != null ? {depth: options.depth} : {}),
    ...(options.subtree != null ? {subtree: options.subtree} : {}),
    ...(options.style ? {style: true} : {}),
  };
  const problem = validateRequest({id: null, tree: true, ...treeDefaults});
  if (problem != null) throw usage(problem.replace(/^"(\w+)"/, '--$1'));
  applySettings(file, options);
  const platform = requirePlatform(options.platform);
  if (!TAP_MODES.includes(options.tapMode as TapMode)) {
    throw usage(`--tap-mode must be one of: ${TAP_MODES.join(', ')}`);
  }
  const host = await ensureHost({quiet: isQuiet(options), verbose: options.verbose});
  warnTimeZone(options);
  const initialLogs = dependencyDiagnostics(file, options, host);
  const result = await bundleOrFail({
    appPath: file,
    setupPath: options.setup,
    projectRoot: options.projectRoot,
    metroConfigPath: options.metroConfig,
    viewportWidth: options.width,
    viewportHeight: options.height,
    platform,
    dev: options.dev,
    verbose: options.verbose,
    tapMode: options.tapMode as TapMode,
    session: true,
    hostConfig: hostConfigFor(platform, options),
    resetCache: options.resetCache,
    cache: options.cache,
    bytecode: bytecodeMode(options.bytecode),
  });
  if (options.keepBundle || options.verbose) {
    process.stderr.write(describeBundle(result));
  }
  try {
    process.exitCode = await runSession({
      bundlePath: result.bundlePath,
      windowWidth: options.width,
      windowHeight: options.height,
      verbose: options.verbose,
      timeoutMs: options.timeout,
      timing: options.timing,
      quiet: isQuiet(options),
      initialLogs,
      failOnFallback: options.failOnFallback,
      allowFallback: options.allowFallback,
      host,
      treeDefaults,
      tz: options.tz,
      io: {
        input: process.stdin,
        output: process.stdout,
        log: line => process.stderr.write(line + '\n'),
      },
    });
  } finally {
    if (result.workDir != null && !options.keepBundle) {
      fs.rmSync(result.workDir, {recursive: true, force: true});
    }
  }
}

type CheckOptions = RunOptions & {rules?: string};

const CHECK_FORMATS = ['json', 'text'];

async function check(file: string, options: CheckOptions) {
  // `format` in a11y-tree.json is for render/run output; check has its own.
  const format = options.format ?? 'json';
  const config = applySettings(file, options);
  requirePlatform(options.platform);
  if (!CHECK_FORMATS.includes(format)) {
    throw usage(`--format must be one of: ${CHECK_FORMATS.join(', ')} (for check)`);
  }
  if (!TAP_MODES.includes(options.tapMode as TapMode)) {
    throw usage(`--tap-mode must be one of: ${TAP_MODES.join(', ')}`);
  }
  let rules: Rules;
  if (options.rules != null) {
    rules = readRulesFile(options.rules);
  } else if (config?.rules != null) {
    rules = config.rules;
  } else {
    throw usage('--rules <json> is required (or "rules" in a11y-tree.json)');
  }
  const script = options.script != null ? readScript(options.script) : undefined;
  const timing: Timing | undefined = options.timing ? {} : undefined;
  const logs: LogEntry[] = [];
  let result: CheckResult | undefined;
  let runtimeFallbacks: string[] = [];
  if (script) {
    const payload = await execute<HostRunPayload>(file, options, {script, tapMode: options.tapMode as TapMode}, timing, logs);
    if (payload) {
      const run = toRunResult(payload);
      runtimeFallbacks = run.fallbacks;
      result = addStepViolations(
        checkTree(run.final, rules, {viewport: run.viewport, source: run.source, subtree: options.subtree}),
        run.steps,
      );
    }
  } else {
    const payload = await execute<HostPayload>(file, options, {}, timing, logs);
    if (payload) {
      const rendered = toRenderResult(payload);
      result = checkTree(rendered.root, rules, {
        viewport: rendered.viewport,
        source: rendered.source,
        subtree: options.subtree,
      });
    }
  }
  if (result) {
    if (logs.length > 0) result.logs = logs;
    result.diagnostics = collectDiagnostics(logs, runtimeFallbacks);
    const policyError = fidelityError(result.diagnostics, options);
    if (policyError) throw policyError;
    write(format === 'text' ? checkText(result) : JSON.stringify(result, null, 2) + '\n', options.out);
    if (!result.ok) process.exitCode = EXIT_CODES.CHECK_FAILED;
  }
  if (timing) printTiming(timing);
}

/** Which JS fallbacks a run used (see runtime/actions.ts). */
function describeFallbacks(steps: Step[]): string[] {
  const used = new Set<string>();
  for (const step of steps) {
    if (step.via?.hitTest === 'js') used.add('hitTest: js');
    if (step.via?.events === 'js') used.add('events: js');
    if (step.warnings?.some(w => w.includes('setTextInputTextByTag'))) {
      used.add('text: not reflected');
    }
  }
  return [...used];
}

const program = new Command()
  .name('rn-a11y-tree')
  .description(
    'Render a React Native component headlessly and print its accessibility/layout tree as JSON',
  )
  // Commander errors become USAGE errors (reportError); subcommands inherit this.
  .enablePositionalOptions()
  .exitOverride()
  .configureOutput({writeErr: () => {}});

function addCommonOptions(command: Command): Command {
  return command
    .argument('<file>', 'component file (default export or `App` named export)')
    .option('--width <dp>', 'viewport width (default 390)', positiveNumber)
    .option('--height <dp>', 'viewport height (default 844)', positiveNumber)
    .option('--preset <name>', `device preset: ${PRESET_NAMES.join(', ')} (platform, viewport, insets, header height)`)
    .option(
      '--platform <name>',
      'Metro platform (required unless --preset or a11y-tree.json sets it): android, ios, a11ytree, or any Metro platform name',
    )
    .option('--out <file>', 'write JSON to a file instead of stdout')
    .option('--keep-bundle', 'keep the Metro bundle and print its path', false)
    .option('--bundle-only', 'only build the bundle, do not run the host', false)
    .option('--timeout <ms>', 'host execution deadline after bundling; timeout exits 5 (default 30000)', timeoutNumber, 30_000)
    .option('--project-root <directory>', 'resolve dependencies and project settings from this app directory')
    .option('--metro-config <file>', 'opt in to supported custom Metro configuration; disables persistent caches')
    .option('--setup <file>', 'native fixture module loaded before the app (relative to cwd)')
    .option('--fail-on-fallback', 'exit 6 for unapproved native/runtime fallbacks or unsupported API calls')
    .option('--no-fail-on-fallback', 'disable the configured fallback policy')
    .option('--allow-fallback <name>', 'allow an exact component/module/runtime fallback name (repeatable)', collect)
    .option('--dev', 'build a development bundle (__DEV__ = true)', false)
    .option('-q, --quiet', 'suppress ordinary app console output and warnings; fallback warnings still print (default when stdout is not a terminal)')
    .option('--no-quiet', 'print app console errors/warnings and CLI warnings on stderr')
    .option('--no-mounted', 'do not read mounted-view values (getA11yTree includeMountedProps)')
    .option('--timing', 'print phase timings as JSON on stderr', false)
    .option('--reset-cache', 'ignore the Metro transform cache and the bundle cache (cold bundle)', false)
    .option('--no-cache', 'do not use the bundle cache (always run Metro)')
    .option('--bytecode <mode>', 'Hermes bytecode: auto (use when cached), on, off', 'auto')
    .option(
      '--header-height <dp>',
      'react-native-screens native header height (default: 44 for --platform ios, else the host default 56)',
      nonNegativeNumber,
    )
    .option(
      '--safe-area-insets <top,left,right,bottom>',
      'safe area insets for react-native-safe-area-context (default 0,0,0,0)',
      parseInsets,
    )
    .option('--scale <n>', 'device pixel ratio for Dimensions/PixelRatio (default: preset, else 3)', positiveNumber)
    .option('--font-scale <n>', 'font scale for Dimensions/PixelRatio (default 1)', positiveNumber)
    .option('--tz <zone>', 'time zone of the app (TZ of the host process), e.g. America/Los_Angeles (default UTC)', timeZone)
    .option('-v, --verbose', 'print Metro progress and host logs to stderr', false);
}

/** `--tz`: an IANA zone name like `UTC` or `Europe/Berlin` (also POSIX forms like `PST8PDT`). */
function timeZone(value: string): string {
  if (!/^[A-Za-z0-9_+:/-]+$/.test(value)) {
    throw new InvalidArgumentError(`"${value}" is not a time zone name (e.g. UTC, America/Los_Angeles)`);
  }
  return value;
}

function timeoutNumber(value: string): number {
  const n = positiveNumber(value);
  if (!Number.isInteger(n) || n > 2_147_483_647) throw new InvalidArgumentError('Timeout must be an integer between 1 and 2147483647 milliseconds.');
  return n;
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function nonNegativeInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError('Must be an integer >= 0.');
  return n;
}

function addOutputOptions(command: Command): Command {
  return command
    .option('--format <format>', 'json (default), compact (no defaults/empties/style), text (one line per node), ndjson')
    .option(
      '--select <selector>',
      'only nodes matching field=value or field~text (testID, role, name, type, key, ref, sel, text); repeat to AND',
      collect,
      [],
    )
    .option('--depth <n>', 'levels of children to keep below each output root', nonNegativeInt)
    .option('--subtree <selector>', 'start the output at the first node matching the selector')
    .option('--style', 'keep style props in compact/ndjson output', false);
}

addCommonOptions(addOutputOptions(program.command('render')))
  .description('render the component and print its tree')
  .option(
    '--debug-props',
    'include raw host debug props on each node (hosts with getA11yTree only)',
    false,
  )
  .action(render);

addCommonOptions(addOutputOptions(program.command('run')))
  .description('render the component, run a script of actions, print steps and trees')
  .option('--script <json>', 'script file or inline JSON: {"actions": [...]} or [...] (required; see below)')
  .option('--tap-mode <mode>', 'events for taps: touch (default), click or both')
  .option('--diff', 'add to each step the changes it made ({added, removed, changed} by key)', false)
  .addHelpText('after', `\n${scriptHelp()}`)
  .action(run);

addCommonOptions(program.command('check'))
  .description('render (or run a script), then evaluate accessibility and design-token rules; exit 2 on violations')
  .option('--rules <json>', 'rules file {"rules": {...}}, or that JSON itself (default: "rules" in a11y-tree.json)')
  .option('--script <json>', 'run these actions first (file or inline JSON, see below) and check the final tree')
  .option('--tap-mode <mode>', 'events for taps: touch (default), click or both')
  .option('--format <format>', 'json (default) or text (one line per violation)')
  .option('--subtree <selector>', 'check only the first node matching the selector and its descendants')
  .addHelpText('after', `\nRules (--rules): {"$schema": "./node_modules/react-native-a11y-tree/schema/rules-file.json", "rules": {...}}.\nFull schema: rn-a11y-tree schema rules-file\n\n${scriptHelp()}`)
  .action(check);

addOutputOptions(program.command('session'))
  .description(
    'render the component and serve JSON-line requests on stdin (actions, tree, quit)',
  )
  .argument('<file>', 'component file (default export or `App` named export)')
  .option('--width <dp>', 'viewport width (default 390)', positiveNumber)
  .option('--height <dp>', 'viewport height (default 844)', positiveNumber)
  .option('--preset <name>', `device preset: ${PRESET_NAMES.join(', ')} (platform, viewport, insets, header height)`)
  .option(
    '--platform <name>',
    'Metro platform (required unless --preset or a11y-tree.json sets it): android, ios, a11ytree, or any Metro platform name',
  )
  .option('--tap-mode <mode>', 'events for taps: touch (default), click or both')
  .option(
    '--timeout <ms>',
    'host-frame and output-write timeout; on timeout the host is killed and the exit code is 5',
    timeoutNumber,
    DEFAULT_TIMEOUT_MS,
  )
  .option('--keep-bundle', 'keep the Metro bundle and print its path', false)
  .option('--project-root <directory>', 'resolve dependencies and project settings from this app directory')
  .option('--metro-config <file>', 'opt in to supported custom Metro configuration; disables persistent caches')
  .option('--setup <file>', 'native fixture module loaded before the app (relative to cwd)')
  .option('--fail-on-fallback', 'exit 6 for unapproved native/runtime fallbacks or unsupported API calls')
  .option('--no-fail-on-fallback', 'disable the configured fallback policy')
  .option('--allow-fallback <name>', 'allow an exact component/module/runtime fallback name (repeatable)', collect)
  .option('--dev', 'build a development bundle (__DEV__ = true)', false)
  .option('-q, --quiet', 'suppress ordinary app console output; fallback warnings still print (default when stdout is not a terminal)')
  .option('--no-quiet', 'print app console output on stderr as [app] lines')
  .option('--no-mounted', 'do not read mounted-view values (getA11yTree includeMountedProps)')
  .option('--timing', 'print phase timings as JSON on stderr', false)
  .option('--reset-cache', 'ignore the Metro transform cache and the bundle cache (cold bundle)', false)
  .option('--no-cache', 'do not use the bundle cache (always run Metro)')
  .option('--bytecode <mode>', 'Hermes bytecode: auto (use when cached), on, off', 'auto')
  .option(
    '--header-height <dp>',
    'react-native-screens native header height (default: 44 for --platform ios, else the host default 56)',
    nonNegativeNumber,
  )
  .option(
    '--safe-area-insets <top,left,right,bottom>',
    'safe area insets for react-native-safe-area-context (default 0,0,0,0)',
    parseInsets,
  )
  .option('--scale <n>', 'device pixel ratio for Dimensions/PixelRatio (default: preset, else 3)', positiveNumber)
  .option('--font-scale <n>', 'font scale for Dimensions/PixelRatio (default 1)', positiveNumber)
  .option('--tz <zone>', 'time zone of the app (TZ of the host process), e.g. America/Los_Angeles (default UTC)', timeZone)
  .option('-v, --verbose', 'print Metro progress and host logs to stderr', false)
  .addHelpText(
    'after',
    `\nRequests (one JSON object per stdin line): {"id": 1, "action": ACTION}, {"id": 2, "tree": true}, {"id": 3, "quit": true}.\n` +
      '--format, --select, --depth, --subtree and --style set the tree of the ready line and the default for tree/snapshot\n' +
      'responses; a request\'s own "format", "select", ... win.\n' +
      'Full schemas: rn-a11y-tree schema session-request, rn-a11y-tree schema session-output-line\n\n' +
      scriptHelp().split('\n').slice(3).join('\n'),
  )
  .action(session);

program.command('doctor')
  .description('inspect app dependencies and local host metadata without starting Metro or native code')
  .argument('[file]', 'app file or project directory', '.')
  .option('--strict', 'exit 1 for untested dependency combinations as well as errors')
  .option('--format <format>', 'json (default) or text', 'json')
  .action(async (file: string, options: {strict?: boolean; format: string}) => {
    if (!['json', 'text'].includes(options.format)) throw usage('--format must be json or text');
    const absolute = path.resolve(file);
    if (!fs.existsSync(absolute)) throw usage(`File or directory not found: ${absolute}`);
    const root = findProjectRoot(fs.statSync(absolute).isDirectory() ? path.join(absolute, '__doctor__') : absolute);
    const report = await inspectDoctor(root, options.strict);
    const text = [report.ok ? 'ok' : 'failed', `project: ${root}`, `tested dependency tuple: ${report.tested}`, `host: ${report.host.found ? report.host.info.bin : report.host.error.message}`,
      ...report.issues.map(issue => `${issue.severity} ${issue.code} ${issue.package}: ${issue.message}`)].join('\n') + '\n';
    write(options.format === 'text' ? text : JSON.stringify(report, null, 2) + '\n', undefined);
    if (!report.ok) process.exitCode = 1;
  });

program
  .command('schema')
  .description('print a JSON Schema of the CLI inputs and outputs (script, rules-file, session-request, ...); no name: list them')
  .argument('[name]', 'schema name, e.g. script')
  .action(printSchema);

// Register locally as well as globally so every subcommand's help exposes the
// flag. Positional options keep global parsing from stealing a subcommand's
// required value (for example, --subtree --no-stderr).
const commands = [program, ...program.commands];
for (const command of commands) command.option('--no-stderr', 'suppress all stderr output, including fallback warnings, errors, verbose logs and timings');

// Parse only option syntax before the real parse can reject an argument. Reuse
// Commander's arity/quoting rules, but not value validators or actions. A flat
// union also recognizes explicit output options when the command is invalid.
const outputProbe = new Command().exitOverride().configureOutput({writeErr: () => {}, writeOut: () => {}});
const seenFlags = new Set<string>();
for (const command of commands) {
  for (const option of command.options) {
    if (seenFlags.has(option.flags)) continue;
    seenFlags.add(option.flags);
    outputProbe.option(option.flags);
  }
}
try { outputProbe.parseOptions(process.argv.slice(2)); } catch { /* Real parsing reports missing values below. */ }
const outputFlags = outputProbe.opts<{stderr?: boolean; format?: string; quiet?: boolean}>();
if (outputFlags.stderr === false) {
  // One sink covers Commander, Metro, forwarded host/session output, console
  // methods, and our error/timing reporters without discarding diagnostics.
  process.stderr.write = (...args: unknown[]): boolean => {
    const callback = args.at(-1);
    if (typeof callback === 'function') process.nextTick(() => callback());
    return true;
  };
}

try {
  await program.parseAsync(process.argv);
} catch (error) {
  reportError(error);
}

function toCliError(error: unknown): CliError | null {
  if (error instanceof CommanderError) {
    // --help / --version exit normally.
    if (error.exitCode === 0) return null;
    return usage(error.message.replace(/^error: /, ''));
  }
  if (error instanceof CliError) return error;
  if (error instanceof ScriptError) return usage(error.message);
  const err = error as Error;
  return new CliError('HOST_CRASHED', err?.message ?? String(error), {
    details: process.env.DEBUG && err?.stack ? {stack: err.stack} : undefined,
  });
}

/**
 * Errors go to stdout as {"error": …} with explicit --format json or ndjson;
 * otherwise to stderr: JSON when stderr is not a terminal or with --quiet,
 * else a readable message.
 */
function reportError(error: unknown) {
  const cliError = toCliError(error);
  if (cliError == null) {
    process.exitCode = 0;
    return;
  }
  const info = cliError.toJSON();
  const {format, quiet} = outputFlags;
  if (format === 'json' || format === 'ndjson') {
    process.stdout.write(JSON.stringify({error: info}, null, format === 'ndjson' ? undefined : 2) + '\n');
  } else if (quiet || !process.stderr.isTTY) {
    process.stderr.write(JSON.stringify({error: info}) + '\n');
  } else {
    process.stderr.write(`rn-a11y-tree: error [${info.code}]: ${info.message}\n`);
    if (info.hint) process.stderr.write(`  hint: ${info.hint}\n`);
    const stack = info.details?.stack;
    if (typeof stack === 'string') process.stderr.write(`${stack}\n`);
    const tail = info.details?.stderrTail;
    if (typeof tail === 'string') process.stderr.write(`--- host stderr (last lines) ---\n${tail}\n`);
  }
  process.exitCode = EXIT_CODES[info.code];
}
