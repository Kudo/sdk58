import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

import {Ajv} from 'ajv';

import {cli, E2E_PRESETS, hostSkip, ROOT} from './helpers.ts';

const ajv = new Ajv({strict: false, allErrors: true});
const schema = (name: string) =>
  ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', `${name}.json`), 'utf8')));

describe('schema', () => {
  it.for(E2E_PRESETS)('[$name] real host output validates against schema/*.json (every example)', {timeout: 600_000}, (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    const renderResult = schema('render-result');
    const runResult = schema('run-result');
    const checkResult = schema('check-result');
    const examples = fs
      .readdirSync(path.join(ROOT, 'examples'))
      .filter(name => fs.existsSync(path.join(ROOT, 'examples', name, 'App.tsx')));
    expect(examples.length).toBeGreaterThanOrEqual(5);
    for (const example of examples) {
      const app = path.join('examples', example, 'App.tsx');
      const render = cli(['render', app], preset);
      expect(render.status, `${example}: ${render.stderr}`).toBe(0);
      expect(renderResult(JSON.parse(render.stdout)), `${example} render: ${ajv.errorsText(renderResult.errors)}`).toBeTruthy();
      const script = path.join('examples', example, 'actions.json');
      if (fs.existsSync(path.join(ROOT, script))) {
        const run = cli(['run', app, '--script', script, '--diff'], preset);
        expect(run.status, `${example}: ${run.stderr}`).toBe(0);
        expect(runResult(JSON.parse(run.stdout)), `${example} run: ${ajv.errorsText(runResult.errors)}`).toBeTruthy();
      }
    }
    const check = cli(['check', 'examples/basic/App.tsx', '--rules', 'examples/basic/rules-fail.json'], preset);
    expect(check.status, check.stderr).toBe(2);
    expect(checkResult(JSON.parse(check.stdout)), ajv.errorsText(checkResult.errors)).toBeTruthy();
  });
});
