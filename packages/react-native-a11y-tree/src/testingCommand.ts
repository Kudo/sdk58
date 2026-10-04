import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {usage} from './errors.ts';

export async function runTests(args: string[]) {
  const require = createRequire(import.meta.url);
  let cli: string;
  try { cli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs'); }
  catch { throw usage('The test runner dependency is missing. Reinstall react-native-a11y-tree with your package manager.'); }
  const config = path.join(path.dirname(fileURLToPath(import.meta.url)), import.meta.url.endsWith('.ts') ? 'testingConfig.ts' : 'test-config.js');
  const child = spawn(process.execPath, [cli, 'run', '--config', config, '--root', process.cwd(), ...args, '--watch=false'], {stdio: 'inherit'});
  const interrupt = (signal: NodeJS.Signals) => child.kill(signal);
  const sigint = () => interrupt('SIGINT');
  const sigterm = () => interrupt('SIGTERM');
  process.on('SIGINT', sigint); process.on('SIGTERM', sigterm);
  try {
    process.exitCode = await new Promise<number>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 1)));
    });
  } finally { process.off('SIGINT', sigint); process.off('SIGTERM', sigterm); }
}
