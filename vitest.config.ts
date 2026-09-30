import {defineConfig} from 'vitest/config';

// E2E only: the unit tests in test/ run with node:test.
export default defineConfig({
  test: {
    include: ['e2e/*.test.ts'],
    // Each test runs the real CLI + host synchronously and sets its own timeout.
    reporters: ['verbose'],
  },
});
