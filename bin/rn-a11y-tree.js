#!/usr/bin/env node
// Installed package: runs the compiled CLI in dist/ (`bun run build`).
// Repo checkout (src/ present): runs the TypeScript sources through tsx, so
// a stale dist/ is never used during development.
import fs from 'node:fs';

const src = new URL('../src/cli.ts', import.meta.url);
if (fs.existsSync(src)) {
  const {register} = await import('tsx/esm/api');
  register();
  await import(src.href);
} else {
  await import('../dist/cli.js');
}
