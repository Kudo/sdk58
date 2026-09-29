import fs from 'node:fs';

import {Command, InvalidArgumentError} from 'commander';

import {bundle} from './bundle.ts';
import {getHostBin, HostError, runHost} from './host.ts';
import {toRenderResult} from './tree.ts';

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

type RenderOptions = {
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

async function render(file: string, options: RenderOptions) {
  const platform = options.platform;
  if (platform == null || platform === '') {
    throw new Error(PLATFORM_REQUIRED_MESSAGE);
  }
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
    return;
  }

  try {
    const payload = await runHost({
      bundlePath: result.bundlePath,
      windowWidth: options.width,
      windowHeight: options.height,
      verbose: options.verbose,
    });
    write(JSON.stringify(toRenderResult(payload), null, 2) + '\n', options.out);
  } finally {
    cleanUp();
  }
}

const program = new Command()
  .name('rn-a11y-tree')
  .description(
    'Render a React Native component headlessly and print its accessibility/layout tree as JSON',
  );

program
  .command('render')
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
  .option(
    '--debug-props',
    'include raw host debug props on each node (hosts with getA11yTree only)',
    false,
  )
  .option('--dev', 'build a development bundle (__DEV__ = true)', false)
  .option('-v, --verbose', 'print Metro progress and host logs to stderr', false)
  .action(render);

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
