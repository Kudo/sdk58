#!/usr/bin/env node
// Stand-in for the Fantom host binary: mimics its stdout protocol.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const args = process.argv.slice(2);
const bundlePath = args[args.indexOf('--bundlePath') + 1];
if (!bundlePath || !fs.existsSync(bundlePath)) {
  console.error(`E0000 fake-host: bundle not found: ${bundlePath}`);
  process.exit(2);
}
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
  };
  console.log(JSON.stringify({type: 'rn-a11y-tree-result', rnA11yTree: payload}));
  process.exit(0);
}
if (process.env.FAKE_HOST_MODE === 'shadow-tree') {
  const shadow = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'shadow-tree.json'),
    'utf8',
  );
  console.log(`{"type":"rn-a11y-tree-result","rnA11yTree":{"viewport":{"width":390,"height":844},"source":"shadowTree","tree":${JSON.stringify(JSON.parse(shadow))}}}`);
  process.exit(0);
}
const tree = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fantom-output.json'),
  'utf8',
);
console.error('I0000 fake-host: glog line on stderr');
console.log(JSON.stringify({type: 'console-log', level: 'info', message: 'hello from JS'}));
console.log(`{"type":"rn-a11y-tree-result","rnA11yTree":{"viewport":{"width":390,"height":844},"source":"mounted","tree":${JSON.stringify(JSON.parse(tree))}}}`);
