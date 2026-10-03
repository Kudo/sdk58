import {defineConfig} from 'vitest/config';

// `bun run test` runs the `unit` project (fake host), `bun run test:e2e` the
// `e2e` project (real host).
export default defineConfig({
  test: {
    reporters: ['verbose'],
    projects: [
      {
        // Many unit tests spawn the CLI (Metro bundle + fake host).
        test: {name: 'unit', include: ['test/*.test.ts'], testTimeout: 120_000},
      },
      {
        // Each test runs the real CLI + host synchronously and sets its own timeout.
        // Metro bundles and native hosts are resource intensive. Unbounded
        // file parallelism can starve subprocesses until their deadline.
        test: {name: 'e2e', include: ['e2e/*.test.ts'], maxWorkers: 4},
      },
    ],
  },
});
