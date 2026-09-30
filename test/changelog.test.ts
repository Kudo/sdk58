import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';

import {changelogSection} from '../scripts/changelog-section.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('changelog', () => {
  it('CHANGELOG.md has a section for the package version; changelog-section.ts extracts it', () => {
    const text = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    expect(JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/rn-a11y-host/package.json'), 'utf8')).version).toBe(version);
    const current = changelogSection(text, version);
    if (current == null || !current.includes('### ')) expect.unreachable(`no section for ${version}`);
    expect(current, 'the section runs into the next one').not.toContain('## [');
    const first = changelogSection(text, '0.1.0')!;
    expect(first).toMatch(/^First release\./);
    expect(first, 'link references are not part of the section').not.toContain('[0.1.0]: https://');
    expect(changelogSection(text, '9.9.9')).toBe(null);

    const cli = spawnSync('bun', [path.join(ROOT, 'scripts/changelog-section.ts'), `v${version}`], {encoding: 'utf8'});
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stdout).toBe(current);
    const missing = spawnSync('bun', [path.join(ROOT, 'scripts/changelog-section.ts'), 'v9.9.9'], {encoding: 'utf8'});
    expect(missing.status).toBe(1);
  });
});
