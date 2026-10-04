import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {usage} from './errors.ts';

export const TEST_HELP = `Usage: rn-a11y-tree test [files] [options]

Run matching *.a11y.test.{ts,tsx,js,jsx} files once; no file runs the suite.
  rn-a11y-tree test a11y/notes.a11y.test.ts
  rn-a11y-tree test a11y/notes.a11y.test.ts -t 'should submit a note'

  -t, --testNamePattern <pattern>  Filter test names (regular expression).
  -h, --help                     Print this help.
  --no-stderr                    Suppress runner stderr; keep stdout/results.
Other Vitest flags pass through, including --reporter and --outputFile.
Exit: 0 success, 1 tests/runner/usage failed, 130 interrupted by SIGINT.
Check executed counts: skipped tests do not verify a flow.
`;

// Keep wrapper flags out of option values and operands after the delimiter.
const VALUE_FLAGS = new Set([
  '-t', '--testNamePattern', '-c', '--config', '-r', '--root', '--reporter', '--outputFile',
  '--project', '--dir', '--pool', '--environment', '--exclude', '--testTimeout', '--hookTimeout', '--maxWorkers',
]);

export function testArguments(args: string[]) {
  const forwarded: string[] = [];
  let help = false;
  let stderr = true;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--') {forwarded.push(...args.slice(index)); break;}
    if (VALUE_FLAGS.has(arg) || (/^--outputFile\./.test(arg) && !arg.includes('='))) {
      const value = args[index + 1];
      if (value === '--help' || value === '-h' || value === '--no-stderr') {
        // Vitest interprets a separate --help as a flag, even after -t.
        const flag = ({'-t': '--testNamePattern', '-c': '--config', '-r': '--root'} as Record<string, string>)[arg] ?? arg;
        forwarded.push(`${flag}=${value}`);
        index++;
      } else {
        forwarded.push(arg);
        if (index + 1 < args.length) forwarded.push(args[++index]);
      }
    } else if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--no-stderr') stderr = false;
    else forwarded.push(arg);
  }
  return {forwarded, help, stderr};
}

export async function runTests(args: string[], stderr = true) {
  const parsed = testArguments(args);
  if (parsed.help) {
    process.stdout.write(TEST_HELP);
    process.exitCode = 0;
    return;
  }
  const require = createRequire(import.meta.url);
  let cli: string;
  try { cli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs'); }
  catch { throw usage('The test runner dependency is missing. Reinstall react-native-a11y-tree with your package manager.'); }
  const config = path.join(path.dirname(fileURLToPath(import.meta.url)), import.meta.url.endsWith('.ts') ? 'testingConfig.ts' : 'test-config.js');
  const child = spawn(process.execPath, [cli, 'run', '--config', config, '--root', process.cwd(), ...parsed.forwarded, '--watch=false'],
    {stdio: ['inherit', 'inherit', stderr && parsed.stderr ? 'inherit' : 'ignore']});
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
