#!/usr/bin/env node
// Runs the TypeScript CLI through tsx (no build step).
import {register} from 'tsx/esm/api';

register();
await import('../src/cli.ts');
