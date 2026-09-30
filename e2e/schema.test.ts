import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {Ajv} from 'ajv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'rn-a11y-tree.js');

const DIST_BIN = path.join(ROOT, 'native', 'dist', process.arch === 'x64' ? 'x86_64' : process.arch, 'rn-a11y-host');
const hostBin = process.env.RN_A11Y_HOST_BIN || (fs.existsSync(DIST_BIN) ? DIST_BIN : undefined);

const ajv = new Ajv({strict: false, allErrors: true});
const schema = (name: string) =>
  ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', `${name}.json`), 'utf8')));

function cli(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args, '--platform', 'android'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {...process.env, RN_A11Y_HOST_BIN: hostBin},
    maxBuffer: 256 * 1024 * 1024,
  });
}

test(
  'real host output validates against schema/*.json (every example)',
  {
    skip: hostBin
      ? false
      : `no host binary: run \`bun run build:host\` (creates ${path.relative(ROOT, DIST_BIN)}) or set RN_A11Y_HOST_BIN`,
    timeout: 600_000,
  },
  () => {
    const renderResult = schema('render-result');
    const runResult = schema('run-result');
    const checkResult = schema('check-result');
    const examples = fs
      .readdirSync(path.join(ROOT, 'examples'))
      .filter(name => fs.existsSync(path.join(ROOT, 'examples', name, 'App.tsx')));
    assert.ok(examples.length >= 5);
    for (const example of examples) {
      const app = path.join('examples', example, 'App.tsx');
      const render = cli(['render', app]);
      assert.equal(render.status, 0, `${example}: ${render.stderr}`);
      assert.ok(renderResult(JSON.parse(render.stdout)), `${example} render: ${ajv.errorsText(renderResult.errors)}`);
      const script = path.join('examples', example, 'actions.json');
      if (fs.existsSync(path.join(ROOT, script))) {
        const run = cli(['run', app, '--script', script, '--diff']);
        assert.equal(run.status, 0, `${example}: ${run.stderr}`);
        assert.ok(runResult(JSON.parse(run.stdout)), `${example} run: ${ajv.errorsText(runResult.errors)}`);
      }
    }
    const check = cli(['check', 'examples/basic/App.tsx', '--rules', 'examples/basic/rules-fail.json']);
    assert.equal(check.status, 2, check.stderr);
    assert.ok(checkResult(JSON.parse(check.stdout)), ajv.errorsText(checkResult.errors));
  },
);
