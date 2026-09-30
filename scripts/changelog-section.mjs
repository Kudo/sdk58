#!/usr/bin/env node
/**
 * Prints the CHANGELOG.md section of a version (without its heading), for
 * the GitHub release body: node scripts/changelog-section.mjs 0.1.1
 * Exits 1 when the version has no section.
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The body of the `## [<version>]` section of `text`, or null. */
export function changelogSection(text, version) {
  const lines = text.split('\n');
  const start = lines.findIndex(l => l.startsWith(`## [${version}]`));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && (l.startsWith('## ') || /^\[[^\]]+\]: /.test(l)));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim() + '\n';
}

if (process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = (process.argv[2] ?? '').replace(/^v/, '');
  const file = process.argv[3] ?? path.join(ROOT, 'CHANGELOG.md');
  const section = changelogSection(fs.readFileSync(file, 'utf8'), version);
  if (section == null) {
    console.error(`changelog-section: no "## [${version}]" section in ${path.relative(ROOT, file)}`);
    process.exit(1);
  }
  process.stdout.write(section);
}
