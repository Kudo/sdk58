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
