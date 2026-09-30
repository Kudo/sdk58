#!/usr/bin/env bun
// Stand-in for the Fantom host binary: mimics its stdout protocol.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// NativeFantom.getHostInfo() of the real host. FAKE_HOST_PROTOCOL=<n> sets
// protocolVersion; FAKE_HOST_PROTOCOL=none: a host without getHostInfo.
const HOST_INFO =
  process.env.FAKE_HOST_PROTOCOL === 'none'
    ? null
    : {
        protocolVersion: Number(process.env.FAKE_HOST_PROTOCOL ?? 1),
        rnVersion: '0.88.0-fake',
        buildType: 'Release',
        sanitize: false,
        engines: {swiftui: true, compose: true},
        fonts: {roboto: true},
      };

const args = process.argv.slice(2);
const bundlePath = args[args.indexOf('--bundlePath') + 1];
if (!bundlePath || !fs.existsSync(bundlePath)) {
  console.error(`E0000 fake-host: bundle not found: ${bundlePath}`);
  process.exit(2);
}
if (args.includes('--interactive')) {
  // Fantom --interactive protocol: "<byte length>\n<code bytes>" frames on
  // stdin; one repl-eval-complete line per frame; exit when stdin closes.
  const shadow = JSON.parse(
    fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'shadow-tree.json'),
      'utf8',
    ),
  );
  let buffer = Buffer.alloc(0);
  let evalId = 0;
  const respond = (response: Record<string, unknown>) =>
    console.log(JSON.stringify({type: 'rn-a11y-tree-response', fallbacks: [], ...response}));
  const handle = (code: string) => {
    const match = /request\(("(?:[^"\\]|\\.)*")\)/.exec(code);
    if (match == null) throw new Error(`fake-host: no request() in ${code}`);
    const request = JSON.parse(JSON.parse(match[1]));
    const {id} = request;
    console.log(JSON.stringify({type: 'console-log', level: 'info', message: `request ${JSON.stringify(request)}`}));
    if (request.start) {
      respond({id, ok: true, ready: true, tree: shadow, hostInfo: HOST_INFO});
    } else if (request.tree) {
      respond({id, ok: true, tree: shadow});
    } else if (request.quit) {
      respond({id, ok: true, quit: true});
    } else if (request.action?.tap?.testID === 'SLOW') {
      // Never answers (simulates a hung runtime).
      return;
    } else if (request.action?.tap?.testID === 'boom') {
      console.log(JSON.stringify({type: 'repl-error', message: 'boom from JS', stack: ''}));
    } else if (request.action && request.diff) {
      const after = structuredClone(shadow);
      after.children[0].children.push({type: 'Paragraph', testID: 'status', text: 'Done', frame: {x: 0, y: 800, width: 390, height: 20}, children: []});
      respond({id, ok: true, step: {index: 0, action: Object.keys(request.action)[0], target: null, hit: null, events: []}, diffTrees: [shadow, after]});
    } else if (request.action) {
      const name = Object.keys(request.action)[0];
      respond({
        id,
        ok: true,
        step: {index: 0, action: name, target: null, hit: {tag: 5, ref: 'n6', testID: 'submit', type: 'View', box: {x: 24.00001, y: 154, width: 342, height: 48}}, events: ['touchStart', 'touchEnd']},
      });
    }
    console.log(JSON.stringify({type: 'repl-eval-complete', id: evalId++}));
  };
  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      const length = Number(buffer.subarray(0, newline).toString());
      if (buffer.length < newline + 1 + length) return;
      const code = buffer.subarray(newline + 1, newline + 1 + length).toString('utf8');
      buffer = buffer.subarray(newline + 1 + length);
      handle(code);
    }
  });
  process.stdin.on('end', () => process.exit(0));
} else {
if (process.env.FAKE_HOST_MODE === 'js-error') {
  console.log(JSON.stringify({type: 'rn-a11y-tree-error', error: {message: 'boom', stack: 'Error: boom\n    at App'}}));
  process.exit(0);
}
if (process.env.FAKE_HOST_MODE === 'run') {
  const shadow = JSON.parse(
    fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'shadow-tree.json'),
      'utf8',
    ),
  );
  const submit = {tag: 5, ref: 'n6', testID: 'submit', type: 'View', box: {x: 24, y: 154.00000123, width: 342, height: 48}};
  const payload = {
    viewport: {width: 390, height: 844},
    source: 'shadowTree',
    steps: [
      {index: 0, action: 'tap', target: submit, hit: {tag: 6, ref: 'n7', testID: null, type: 'Paragraph', box: {x: 164, y: 168, width: 62, height: 20}}, events: ['touchStart', 'touchEnd'], via: {hitTest: 'js', events: 'js'}},
      {index: 1, action: 'tap', target: null, hit: null, events: [], error: 'Target not found: {"testID":"missing"}'},
      {index: 2, action: 'snapshot', target: null, hit: null, events: []},
    ],
    snapshots: {after: shadow},
    final: shadow,
    hostInfo: HOST_INFO,
  };
  console.log(JSON.stringify({type: 'rn-a11y-tree-result', rnA11yTree: payload}));
  process.exit(0);
}
if (process.env.FAKE_HOST_MODE === 'shadow-tree') {
  const shadow = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'shadow-tree.json'),
    'utf8',
  );
  console.log(`{"type":"rn-a11y-tree-result","rnA11yTree":{"viewport":{"width":390,"height":844},"source":"shadowTree","hostInfo":${JSON.stringify(HOST_INFO)},"tree":${JSON.stringify(JSON.parse(shadow))}}}`);
  process.exit(0);
}
const tree = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fantom-output.json'),
  'utf8',
);
console.error('I0000 fake-host: glog line on stderr');
console.log(JSON.stringify({type: 'console-log', level: 'info', message: 'hello from JS'}));
console.log(`{"type":"rn-a11y-tree-result","rnA11yTree":{"viewport":{"width":390,"height":844},"source":"mounted","hostInfo":${JSON.stringify(HOST_INFO)},"tree":${JSON.stringify(JSON.parse(tree))}}}`);
}
