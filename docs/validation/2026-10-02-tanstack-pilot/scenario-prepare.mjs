// Run after the existing prepare.mjs, or against its retained temporary app.
// Adds only scenario setup files; verifies upstream source before writing them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync('/tmp/tanstack-pilot-path', 'utf8');
const evidence = JSON.parse(fs.readFileSync(path.join(directory, 'evidence.json')));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
for (const [file, expected] of Object.entries(evidence.upstream.filesSha256)) {
  if (file !== 'package.json') {
    assert.equal(hash(fs.readFileSync(path.join(app, file))), expected, file);
  }
}
assert.equal(hash(fs.readFileSync(path.join(app, 'package-lock.json'))), evidence.appLockSha256);
assert.equal(hash(fs.readFileSync(path.join(app, 'pilot-fixtures.ts'))), evidence.fixtureSha256);
for (const scenario of ['empty', 'error']) {
  const filename = `scenario-${scenario}-fixtures.ts`;
  fs.copyFileSync(path.join(directory, filename), path.join(app, filename));
}
console.log(`Verified upstream hashes and added two explicit scenario fixtures: ${app}`);
