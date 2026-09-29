import fs from 'node:fs';

import {Command, InvalidArgumentError} from 'commander';

import {bundle, type HostConfig, type TapMode} from './bundle.ts';
import {getHostBin, HostError, runHost} from './host.ts';
import type {HostPayload, HostRunPayload, Step} from './schema.ts';
import {ScriptError, validateScript} from './script.ts';
import {DEFAULT_TIMEOUT_MS, runSession} from './session.ts';
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
  headerHeight?: number;
  safeAreaInsets?: HostConfig['safeAreaInsets'];
};

type RenderOptions = HostConfigOptions & {
  width: number;
  height: number;
  platform?: string;
  out?: string;
  keepBundle: boolean;
  bundleOnly: boolean;
  dev: boolean;
  debugProps: boolean;
  verbose: boolean;
};

function write(text: string, out: string | undefined) {
  if (out) {
    fs.writeFileSync(out, text);
  } else {
    process.stdout.write(text);
  }
}

const PLATFORM_REQUIRED_MESSAGE = `--platform <name> is required. Known values: android, ios, a11ytree. Any Metro platform name is accepted.
Note: React Native core components branch on Platform.OS (e.g. TextInput, Switch), so use android or ios for them to render.`;

type RunOptions = RenderOptions & {script?: string; tapMode: string; timeout?: number};

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
  const headerHeight = options.headerHeight ?? (platform === 'ios' ? 44 : undefined);
  if (headerHeight != null) config.headerHeight = headerHeight;
  if (options.safeAreaInsets != null) config.safeAreaInsets = options.safeAreaInsets;
  return config;
}

function requirePlatform(platform: string | undefined): string {
  if (platform == null || platform === '') {
    throw new Error(PLATFORM_REQUIRED_MESSAGE);
  }
  return platform;
}

function readScript(scriptPath: string | undefined) {
  if (scriptPath == null || scriptPath === '') {
    throw new ScriptError('--script <json> is required');
  }
  let text: string;
  try {
    text = fs.readFileSync(scriptPath, 'utf8');
  } catch (error) {
    throw new ScriptError(`cannot read ${scriptPath}: ${(error as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ScriptError(`${scriptPath} is not valid JSON: ${(error as Error).message}`);
  }
  try {
    return validateScript(json);
  } catch (error) {
    throw new ScriptError(`${scriptPath}: ${(error as Error).message}`);
  }
}

/**
 * Bundles the app (with an optional script), runs the host and returns the
 * payload. Returns undefined for --bundle-only.
 */
async function execute<T>(
  file: string,
  options: RenderOptions,
  extra: {script?: unknown[]; tapMode?: TapMode},
): Promise<T | undefined> {
  const platform = requirePlatform(options.platform);
  if (!options.bundleOnly) {
    // Fail before spending time on Metro.
    getHostBin();
  }
  const result = await bundle({
    appPath: file,
    viewportWidth: options.width,
    viewportHeight: options.height,
    platform,
    dev: options.dev,
    includeDebugProps: options.debugProps,
    verbose: options.verbose,
    hostConfig: hostConfigFor(platform, options),
    ...extra,
  });
  const cleanUp = () => {
    if (!options.keepBundle && !options.bundleOnly) {
      fs.rmSync(result.workDir, {recursive: true, force: true});
    }
  };

  if (options.keepBundle || options.bundleOnly || options.verbose) {
    process.stderr.write(
      `Bundle: ${result.bundlePath} (${result.sizeBytes} bytes)\n`,
    );
  }
  if (options.bundleOnly) {
    return undefined;
  }

  try {
    return await runHost<T>({
      bundlePath: result.bundlePath,
      windowWidth: options.width,
      windowHeight: options.height,
      verbose: options.verbose,
    });
  } finally {
    cleanUp();
  }
}

async function render(file: string, options: RenderOptions) {
  const payload = await execute<HostPayload>(file, options, {});
  if (payload) {
    write(JSON.stringify(toRenderResult(payload), null, 2) + '\n', options.out);
  }
}

async function run(file: string, options: RunOptions) {
  requirePlatform(options.platform);
  if (!TAP_MODES.includes(options.tapMode as TapMode)) {
    throw new Error(`--tap-mode must be one of: ${TAP_MODES.join(', ')}`);
  }
  // Validate before bundling.
  const script = readScript(options.script);
  const payload = await execute<HostRunPayload>(file, options, {
    script,
    tapMode: options.tapMode as TapMode,
  });
  if (payload) {
    const fallbacks = [
      ...new Set([...(payload.fallbacks ?? []), ...describeFallbacks(payload.steps)]),
    ].sort();
    if (fallbacks.length > 0) {
      process.stderr.write(
        `rn-a11y-tree: warning: JS fallbacks used because the host lacks native methods: ${fallbacks.join(', ')}\n`,
      );
    }
    write(JSON.stringify(toRunResult(payload), null, 2) + '\n', options.out);
  }
}

async function session(file: string, options: RunOptions) {
  const platform = requirePlatform(options.platform);
  if (!TAP_MODES.includes(options.tapMode as TapMode)) {
    throw new Error(`--tap-mode must be one of: ${TAP_MODES.join(', ')}`);
  }
  getHostBin();
  const result = await bundle({
    appPath: file,
    viewportWidth: options.width,
    viewportHeight: options.height,
    platform,
    dev: options.dev,
    verbose: options.verbose,
    tapMode: options.tapMode as TapMode,
    session: true,
    hostConfig: hostConfigFor(platform, options),
  });
  if (options.keepBundle || options.verbose) {
    process.stderr.write(`Bundle: ${result.bundlePath} (${result.sizeBytes} bytes)\n`);
  }
  try {
    process.exitCode = await runSession({
      bundlePath: result.bundlePath,
      windowWidth: options.width,
      windowHeight: options.height,
      verbose: options.verbose,
      timeoutMs: options.timeout,
      io: {
        input: process.stdin,
        output: process.stdout,
        log: line => process.stderr.write(line + '\n'),
      },
    });
  } finally {
    if (!options.keepBundle) {
      fs.rmSync(result.workDir, {recursive: true, force: true});
    }
  }
}

/** Which JS fallbacks a run used (see runtime/actions.js). */
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
  );

function addCommonOptions(command: Command): Command {
  return command
    .argument('<file>', 'component file (default export or `App` named export)')
    .option('--width <dp>', 'viewport width', positiveNumber, 390)
    .option('--height <dp>', 'viewport height', positiveNumber, 844)
    .option(
      '--platform <name>',
      'Metro platform (required): android, ios, a11ytree, or any Metro platform name',
    )
    .option('--out <file>', 'write JSON to a file instead of stdout')
    .option('--keep-bundle', 'keep the Metro bundle and print its path', false)
    .option('--bundle-only', 'only build the bundle, do not run the host', false)
    .option('--dev', 'build a development bundle (__DEV__ = true)', false)
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
    .option('-v, --verbose', 'print Metro progress and host logs to stderr', false);
}

addCommonOptions(program.command('render'))
  .description('render the component and print its tree')
  .option(
    '--debug-props',
    'include raw host debug props on each node (hosts with getA11yTree only)',
    false,
  )
  .action(render);

addCommonOptions(program.command('run'))
  .description('render the component, run a script of actions, print steps and trees')
  .option('--script <json>', 'JSON file with an array of actions (required)')
  .option('--tap-mode <mode>', 'events for taps: touch, click or both', 'touch')
  .action(run);

program
  .command('session')
  .description(
    'render the component and serve JSON-line requests on stdin (actions, tree, quit)',
  )
  .argument('<file>', 'component file (default export or `App` named export)')
  .option('--width <dp>', 'viewport width', positiveNumber, 390)
  .option('--height <dp>', 'viewport height', positiveNumber, 844)
  .option(
    '--platform <name>',
    'Metro platform (required): android, ios, a11ytree, or any Metro platform name',
  )
  .option('--tap-mode <mode>', 'events for taps: touch, click or both', 'touch')
  .option(
    '--timeout <ms>',
    'per-request timeout; on timeout the host is killed and the exit code is 1',
    positiveNumber,
    DEFAULT_TIMEOUT_MS,
  )
  .option('--keep-bundle', 'keep the Metro bundle and print its path', false)
  .option('--dev', 'build a development bundle (__DEV__ = true)', false)
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
  .option('-v, --verbose', 'print Metro progress and host logs to stderr', false)
  .action(session);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const err = error as Error;
  process.stderr.write(`rn-a11y-tree: ${err.message}\n`);
  if (err instanceof HostError) {
    if (err.details?.stack) process.stderr.write(`${err.details.stack}\n`);
    if (err.details?.stderr) {
      process.stderr.write(`--- host stderr ---\n${err.details.stderr}\n`);
    }
  } else if (process.env.DEBUG && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exitCode = 1;
}
