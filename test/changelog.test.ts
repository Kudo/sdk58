import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {changelogSection} from '../scripts/changelog-section.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('CHANGELOG.md has a section for the package version; changelog-section.mjs extracts it', () => {
  const text = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/rn-a11y-host/package.json'), 'utf8')).version, version);
  const current = changelogSection(text, version);
  assert.ok(current && current.includes('### '), `no section for ${version}`);
  assert.ok(!current.includes('## ['), 'the section runs into the next one');
  const first = changelogSection(text, '0.1.0')!;
  assert.match(first, /^First release\./);
  assert.ok(!first.includes('[0.1.0]: https://'), 'link references are not part of the section');
  assert.equal(changelogSection(text, '9.9.9'), null);

  const cli = spawnSync(process.execPath, [path.join(ROOT, 'scripts/changelog-section.mjs'), `v${version}`], {encoding: 'utf8'});
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout, current);
  const missing = spawnSync(process.execPath, [path.join(ROOT, 'scripts/changelog-section.mjs'), 'v9.9.9'], {encoding: 'utf8'});
  assert.equal(missing.status, 1);
});
