/**
 * Timestamps (ms) for `--timing`, on the same clock as Metro's
 * __BUNDLE_START_TIME__ (nativePerformanceNow when the host has it).
 */

export function now(): number {
  return typeof global.nativePerformanceNow === 'function'
    ? global.nativePerformanceNow()
    : performance.now();
}

const marks: Record<string, number | undefined> = {};
const counters: Record<string, number> = {};

export function count(name: string, value: number): void {
  counters[name] = value;
}

export function mark(name: string): void {
  marks[name] = now();
}

/** Durations between the marks that exist. */
export function summarize(): Record<string, number | undefined> {
  const start = global.__BUNDLE_START_TIME__;
  const d = (a: number | undefined, b: number | undefined): number | undefined =>
    a != null && b != null ? Math.round((b - a) * 1000) / 1000 : undefined;
  return {
    // Bundle evaluation up to the end of the app's module setup.
    evalMs: d(start, marks.setupEnd),
    renderMs: d(marks.renderStart, marks.rendered),
    settleMs: d(marks.rendered, marks.settled),
    actionsMs: d(marks.settled, marks.actionsEnd),
    dumpMs: d(marks.dumpStart, marks.dumpEnd),
    // From bundle start to the result being ready in JS.
    jsTotalMs: d(start, marks.dumpEnd),
    ...counters,
  };
}
