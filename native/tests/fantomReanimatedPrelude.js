/**
 * @flow strict-local
 * @format
 */

// rn-a11y: reanimated
// Fantom defines `global.jest = {fn}` (runtime/setup.js). Reanimated treats a
// defined `globalThis.jest` as Jest (src/common/constants/platform.ts IS_JEST)
// and then uses its JS implementation instead of the native module. Import this
// file before react-native-reanimated so the native path is used.
// $FlowExpectedError[cannot-write]
delete global.jest;
