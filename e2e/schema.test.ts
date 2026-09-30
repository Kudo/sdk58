import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

import {Ajv} from 'ajv';

import {cli, E2E_PRESETS, hostSkip, ROOT} from './helpers.ts';

const ajv = new Ajv({strict: false, allErrors: true});
const schema = (name: string) =>
  ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', `${name}.json`), 'utf8')));

for (const preset of E2E_PRESETS) {
  test(`[${preset.name}] real host output validates against schema/*.json (every example)`, {skip: hostSkip, timeout: 600_000}, () => {
    const renderResult = schema('render-result');
    const runResult = schema('run-result');
    const checkResult = schema('check-result');
    const examples = fs
      .readdirSync(path.join(ROOT, 'examples'))
      .filter(name => fs.existsSync(path.join(ROOT, 'examples', name, 'App.tsx')));
    assert.ok(examples.length >= 5);
    for (const example of examples) {
      const app = path.join('examples', example, 'App.tsx');
      const render = cli(['render', app], preset);
      assert.equal(render.status, 0, `${example}: ${render.stderr}`);
      assert.ok(renderResult(JSON.parse(render.stdout)), `${example} render: ${ajv.errorsText(renderResult.errors)}`);
      const script = path.join('examples', example, 'actions.json');
      if (fs.existsSync(path.join(ROOT, script))) {
        const run = cli(['run', app, '--script', script, '--diff'], preset);
        assert.equal(run.status, 0, `${example}: ${run.stderr}`);
        assert.ok(runResult(JSON.parse(run.stdout)), `${example} run: ${ajv.errorsText(runResult.errors)}`);
      }
    }
    const check = cli(['check', 'examples/basic/App.tsx', '--rules', 'examples/basic/rules-fail.json'], preset);
    assert.equal(check.status, 2, check.stderr);
    assert.ok(checkResult(JSON.parse(check.stdout)), ajv.errorsText(checkResult.errors));
  });
}
