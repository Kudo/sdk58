/**
 * Modules without TypeScript declarations (react-native's generated
 * declarations in types_generated/ do not cover them).
 */

declare module 'react-native/src/private/setup/setUpDefaultReactNativeEnvironment' {
  /** Sets up the React Native environment (InitializeCore without LogBox and dev tools). */
  export default function setUpDefaultReactNativeEnvironment(enableDeveloperTools: boolean): void;
}
