import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), import.meta.url.endsWith('.ts') ? 'testing.ts' : 'test.js');

export default defineConfig({
  resolve: {alias: {'react-native-a11y-tree/test': helper}},
  test: {
    include: ['**/*.a11y.test.{ts,tsx,js,jsx}'],
    setupFiles: [helper],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    maxWorkers: 2,
    reporters: ['default'],
    environment: 'node',
  },
});
