/**
 * Globals of the Hermes runtime the bundle runs in (no DOM, no Node), as far
 * as runtime/ uses them.
 */

// --- Metro's module system and the JS engine ---------------------------------

/** Metro's `require` (the module's exports; cast with `typeof import(...)`). */
declare function require(id: string): unknown;
declare var module: {exports: unknown};

declare var __DEV__: boolean;
/** React Native's alias of `globalThis`. */
declare var global: typeof globalThis;

declare var console: {
  log(...data: unknown[]): void;
  info(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
};
declare var performance: {now(): number};

// --- set by the host and React Native ----------------------------------------

/** Host clock (ms), the clock of __BUNDLE_START_TIME__. */
declare var nativePerformanceNow: (() => number) | undefined;
declare var __BUNDLE_START_TIME__: number | undefined;
declare var nativeRuntimeScheduler: {
  unstable_scheduleCallback(priority: number, callback: () => void | Promise<void>): unknown;
  unstable_ImmediatePriority: number;
};
/** TurboModule lookup (see turboModuleStubs.ts). */
declare var __turboModuleProxy: ((name: string) => unknown) | null | undefined;

// --- set by the runtime ------------------------------------------------------

/** Called by the host after the bundle loads (fantom/setup.ts). */
declare var $$RunTests$$: (() => void) | undefined;
/** Setup error of a session bundle (fantom/setup.ts). */
declare var __rnA11ySetupError: Error | undefined;
/** Session mode request entry point (session.ts). */
declare var __rnA11y: {request(json: string): void} | undefined;
/** Pointer input for react-native-gesture-handler (gh/NativeRNGestureHandlerModule.ts). */
declare var __rnA11yGestureHandler:
  | import('./gh/NativeRNGestureHandlerModule').GestureHandlerBridge
  | undefined;
/** Read by react-native-gesture-handler for the v3 detector's `moduleId`. */
declare var _RNGH_MODULE_ID: number | undefined;
declare var __FANTOM_PACKAGE_LOADED__: boolean | undefined;
/** Expo's global (installExpoGlobalPolyfill; expo/prelude.ts). */
declare var expo: import('./expo/prelude').ExpoGlobal | undefined;

// --- entry-template.ts placeholders (src/bundle.ts renderEntry) ---------------

declare const __HOST_CONFIG__: import('./hostConfig').HostConfig;
declare const __VIEWPORT_WIDTH__: number;
declare const __VIEWPORT_HEIGHT__: number;
declare const __INCLUDE_DEBUG_PROPS__: boolean;
declare const __SCRIPT__: import('./actions').Action[] | null;
declare const __TAP_MODE__: import('./actions').TapMode;
declare const __RUN_OPTIONS__: {diff?: boolean};
declare const __SESSION__: boolean;
