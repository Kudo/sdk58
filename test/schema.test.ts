import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {Ajv, type ValidateFunction} from 'ajv';

import {generate, SCHEMAS} from '../src/genSchema.ts';
import {type ToolName, TOOLS, toolArgv} from '../src/tools.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'cli.ts');
const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');
const FAKE_HOST = path.join(ROOT, 'test', 'fixtures', 'fake-host.ts');

const ajv = new Ajv({strict: false, allErrors: true});
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const validators = new Map<string, ValidateFunction>();
function validator(file: string, pick?: (json: Record<string, unknown>) => unknown): ValidateFunction {
  const id = file + (pick ? '#' + pick.toString() : '');
  if (!validators.has(id)) {
    const json = readJson(file);
    validators.set(id, ajv.compile((pick ? pick(json) : json) as object));
  }
  return validators.get(id)!;
}

function assertValid(file: string, value: unknown, pick?: (json: Record<string, unknown>) => unknown) {
  const validate = validator(file, pick);
  assert.ok(validate(value), `${file}: ${ajv.errorsText(validate.errors, {separator: '\n'})}`);
}

function cli(args: string[], env: Record<string, string> = {}, input?: string) {
  return spawnSync('node', [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {...process.env, RN_A11Y_HOST_BIN: FAKE_HOST, ...env},
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
}

test('schema/*.json and tools/*.json are up to date (bun run schema)', {timeout: 120_000}, () => {
  const files = generate();
  assert.equal(files.size, Object.keys(SCHEMAS).length + TOOLS.length);
  for (const [file, content] of files) {
    assert.equal(fs.readFileSync(path.join(ROOT, file), 'utf8'), content, `${file} is out of date: run bun run schema`);
  }
});

test('input files validate: scripts, rules files; bad ones do not', () => {
  for (const example of fs.readdirSync(path.join(ROOT, 'examples'))) {
    const file = path.join('examples', example, 'actions.json');
    if (fs.existsSync(path.join(ROOT, file))) assertValid('schema/script.json', readJson(file));
  }
  assertValid('schema/rules-file.json', readJson('examples/basic/rules-fail.json'));
  assertValid('schema/rules-file.json', readJson('examples/basic/rules-pass.json'));
  assertValid('schema/a11y-tree-config.json', {preset: 'ios-phone', format: 'text', rules: {names: true}});
  const script = validator('schema/script.json');
  assert.equal(script([{swipe: {testID: 'x'}}]), false);
  assert.equal(script([{tap: {testID: 'x', extra: 1}}]), false);
  assert.equal(validator('schema/rules-file.json')({rules: {colours: true}}), false);
  assert.equal(validator('schema/a11y-tree-config.json')({preset: 'watch'}), false);
});

test('CLI output validates against the schemas (fake host)', {timeout: 300_000}, () => {
  const render = cli(['render', APP, '--platform', 'android']);
  assert.equal(render.status, 0, render.stderr);
  assertValid('schema/render-result.json', JSON.parse(render.stdout));

  const shadow = cli(['render', APP, '--platform', 'android', '--debug-props'], {FAKE_HOST_MODE: 'shadow-tree'});
  assertValid('schema/render-result.json', JSON.parse(shadow.stdout));
  const query = cli(['render', APP, '--platform', 'android', '--select', 'role=button'], {FAKE_HOST_MODE: 'shadow-tree'});
  assertValid('schema/query-result.json', JSON.parse(query.stdout));

  const run = cli(['run', APP, '--platform', 'android', '--script', 'examples/basic/actions.json'], {FAKE_HOST_MODE: 'run'});
  assert.equal(run.status, 0, run.stderr);
  assertValid('schema/run-result.json', JSON.parse(run.stdout));

  const check = cli(['check', APP, '--platform', 'android', '--rules', 'examples/basic/rules-fail.json'], {
    FAKE_HOST_MODE: 'shadow-tree',
  });
  assert.equal(check.status, 2, check.stderr);
  assertValid('schema/check-result.json', JSON.parse(check.stdout));

  const error = cli(['render', APP, '--platform', 'android', '--format', 'json'], {RN_A11Y_HOST_BIN: '/nonexistent'});
  assert.equal(error.status, 5);
  assertValid('schema/error-output.json', JSON.parse(error.stdout));
  const usageError = cli(['render', APP, '--platform', 'android', '--bogus']);
  assertValid('schema/error-output.json', JSON.parse(usageError.stderr));

  const requests = [
    {id: 1, action: {tap: {testID: 'submit'}}, diff: true},
    {id: 2, tree: true},
    {id: 3, tree: true, format: 'text', select: 'role=button'},
    {id: 4, action: {tap: {testID: 'boom'}}},
    {id: 5, quit: true},
  ];
  for (const request of requests) assertValid('schema/session-request.json', request);
  assert.equal(validator('schema/session-request.json')({id: 1, tree: true, quit: true}), false);
  const session = cli(
    ['session', APP, '--platform', 'android'],
    {},
    [...requests.slice(0, 4).map(r => JSON.stringify(r)), 'not json', JSON.stringify(requests[4])].join('\n') + '\n',
  );
  assert.equal(session.status, 0, session.stderr);
  const lines = session.stdout.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(lines.length, 7);
  for (const line of lines) assertValid('schema/session-output-line.json', line);
});

test('tool descriptors: examples validate, argv maps to the CLI, output matches outputSchema (fake host)', {timeout: 300_000}, () => {
  for (const tool of TOOLS) {
    const descriptor = readJson(`tools/${tool.name}.json`);
    assert.equal(descriptor.name, tool.name);
    assert.ok(descriptor.description.length > 40);
    assert.equal(descriptor.inputSchema.type, 'object');
    assert.ok(descriptor.inputSchema.required.includes('file'));
    const input = validator(`tools/${tool.name}.json`, d => d.inputSchema);
    for (const example of descriptor.examples) {
      assert.ok(input(example.input), `${tool.name}: ${ajv.errorsText(input.errors)}`);
      assert.deepEqual(example.argv, ['rn-a11y-tree', ...toolArgv(tool.name, example.input)]);
    }
    assert.equal(input({...tool.example, bogus: 1}), false, `${tool.name} accepts unknown keys`);
  }
  assert.deepEqual(toolArgv('diff', {file: 'A.tsx', preset: 'ios-phone', actions: [{wait: 1}], mounted: false}), [
    'run',
    'A.tsx',
    '--preset',
    'ios-phone',
    '--script',
    '[{"wait":1}]',
    '--no-mounted',
    '--diff',
  ]);
  assert.deepEqual(
    toolArgv('render', {file: 'A.tsx', safeAreaInsets: {top: 47, left: 0, right: 0, bottom: 34}, headerHeight: 0, dev: true}),
    ['render', 'A.tsx', '--safe-area-insets', '47,0,0,34', '--header-height', '0', '--dev'],
  );

  // Run each tool's example with format json through the CLI (inline --script / --rules).
  const modes: Partial<Record<ToolName, string>> = {render: 'shadow-tree', query: 'shadow-tree', act: 'run', diff: 'run', check: 'shadow-tree'};
  for (const [name, mode] of Object.entries(modes) as Array<[ToolName, string]>) {
    const tool = TOOLS.find(t => t.name === name)!;
    // The fake host has a fixed 390x844 viewport; preset only changes the bundle.
    const example = {...tool.example, format: 'json'};
    const proc = cli(toolArgv(name, example), {FAKE_HOST_MODE: mode});
    assert.ok(proc.status === 0 || (name === 'check' && proc.status === 2), `${name}: ${proc.stderr}`);
    assertValid(`tools/${name}.json`, JSON.parse(proc.stdout), d => d.outputSchema);
  }
});
