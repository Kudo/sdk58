/**
 * Generates `schema/*.json` (JSON Schema draft-07, from the types in
 * src/schema.ts) and `tools/*.json` (tool descriptors, from src/tools.ts).
 *
 *   bun run schema          write the files
 *   bun run schema --check  exit 1 if a file is out of date
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {createGenerator, type Config} from 'ts-json-schema-generator';

import {EXIT_CODES} from './errors.ts';
import {TOOLS, toolArgv} from './tools.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Output file (without .json) -> exported type in src/schema.ts. */
export const SCHEMAS: Record<string, string> = {
  'render-result': 'RenderResult',
  'query-result': 'QueryResult',
  'run-result': 'RunResult',
  'check-result': 'CheckResult',
  'error-output': 'ErrorOutput',
  script: 'Script',
  'rules-file': 'RulesFile',
  'a11y-tree-config': 'ProjectConfigFile',
  'session-request': 'SessionRequest',
  'session-output-line': 'SessionOutputLine',
};

type Schema = Record<string, unknown> & {definitions?: Record<string, unknown>};

function generator(file: string) {
  const config: Config = {
    path: path.join(ROOT, file),
    tsconfig: path.join(ROOT, 'tsconfig.json'),
    type: '*',
    expose: 'export',
    topRef: false,
    jsDoc: 'extended',
    skipTypeCheck: true,
    additionalProperties: false,
    sortProps: true,
  };
  return createGenerator(config);
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

/** Returns path (relative to the repo root) -> file content. */
export function generate(): Map<string, string> {
  const files = new Map<string, string>();
  const schemas = generator('src/schema.ts');
  const outputs: Record<string, Schema> = {};
  for (const [name, type] of Object.entries(SCHEMAS)) {
    const schema = schemas.createSchema(type) as Schema;
    const out: Schema = {$schema: schema.$schema, title: type, ...schema};
    outputs[name] = out;
    files.set(`schema/${name}.json`, json(out));
  }

  const inputs = generator('src/tools.ts');
  for (const tool of TOOLS) {
    const inputSchema = inputs.createSchema(tool.inputType) as Schema;
    delete inputSchema.$schema;
    const outputSchema =
      tool.output.length === 1
        ? outputs[tool.output[0]]
        : {
            $schema: outputs[tool.output[0]].$schema,
            anyOf: tool.output.map(name => {
              const {$schema: _s, definitions: _d, ...rest} = outputs[name];
              return rest;
            }),
            definitions: Object.assign({}, ...tool.output.map(name => outputs[name].definitions)),
          };
    const descriptor: Record<string, unknown> = {
      name: tool.name,
      description: tool.description,
      inputSchema,
      outputSchema,
      examples: [{input: tool.example, argv: ['rn-a11y-tree', ...toolArgv(tool.name, tool.example)]}],
      'x-cli': {
        command: tool.command,
        outputSchemaFiles: tool.output.map(name => `schema/${name}.json`),
        note: 'Output matches outputSchema with format "json" (the default). Errors: schema/error-output.json.',
        exitCodes: {
          0: 'ok',
          ...Object.fromEntries(
            Object.entries(
              Object.entries(EXIT_CODES).reduce<Record<number, string[]>>((acc, [code, exit]) => {
                (acc[exit] ??= []).push(code);
                return acc;
              }, {}),
            ).map(([exit, codes]) => [exit, codes.join(', ')]),
          ),
        },
      },
    };
    if (tool.name === 'session') {
      descriptor['x-protocol'] = {
        stdin: 'one JSON request per line (schema/session-request.json)',
        stdout: 'a ready line, then one response line per request (schema/session-output-line.json)',
        requestSchema: outputs['session-request'],
        examples: [
          {id: 1, action: {tap: {testID: 'remember'}}, diff: true},
          {id: 2, tree: true, format: 'text', select: 'role=button'},
          {id: 3, quit: true},
        ],
      };
    }
    files.set(`tools/${tool.name}.json`, json(descriptor));
  }
  return files;
}

function main() {
  const check = process.argv.includes('--check');
  const files = generate();
  const stale: string[] = [];
  for (const [file, content] of files) {
    const target = path.join(ROOT, file);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current === content) continue;
    if (check) {
      stale.push(file);
    } else {
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, content);
      process.stderr.write(`wrote ${file}\n`);
    }
  }
  if (stale.length > 0) {
    process.stderr.write(`out of date (run \`bun run schema\`): ${stale.join(', ')}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) main();
