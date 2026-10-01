/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type {
  RootTag,
  TurboModule,
} from 'react-native/Libraries/TurboModule/RCTExport';

import * as TurboModuleRegistry from 'react-native/Libraries/TurboModule/TurboModuleRegistry';

// match RenderFormatOptions.h
export type RenderFormatOptions = {
  includeRoot: boolean;
  includeLayoutMetrics: boolean;
};

// match RawEvent.h
export const NativeEventCategory = {
  /*
   * Start of a continuous event. To be used with touchStart.
   */
  ContinuousStart: 0,

  /*
   * End of a continuous event. To be used with touchEnd.
   */
  ContinuousEnd: 1,

  /*
   * Priority for this event will be determined from other events in the
   * queue. If it is triggered by continuous event, its priority will be
   * default. If it is not triggered by continuous event, its priority will be
   * discrete.
   */
  Unspecified: 2,

  /*
   * Forces discrete type for the event. Regardless if continuous event is
   * ongoing.
   */
  Discrete: 3,

  /*
   * Forces continuous type for the event. Regardless if continuous event
   * isn't ongoing.
   */
  Continuous: 4,

  /*
   * Priority for events that can be processed in idle times or in the
   * background.
   */
  Idle: 5,
} as const;
export type NativeEventCategory = (typeof NativeEventCategory)[keyof typeof NativeEventCategory];

export type ScrollOptions = {
  x: number;
  y: number;
  zoomScale?: number;
};

export type ImageResponse = {
  width: number;
  height: number;
  cacheStatus?: 'memory' | 'disk' | 'disk/memory';
  errorMessage?: string;
};

// Added by react-native-a11y-tree (not in upstream Fantom).
export type EdgeInsets = {top: number; left: number; right: number; bottom: number};

// Added by react-native-a11y-tree: NativeFantom.setDeviceMetrics argument.
export type DeviceMetrics = {
  width: number;
  height: number;
  scale?: number;
  fontScale?: number;
};

interface Spec extends TurboModule {
  startSurface: (
    viewportWidth: number,
    viewportHeight: number,
    devicePixelRatio: number,
    viewportOffsetX?: number,
    viewportOffsetY?: number,
  ) => RootTag;
  stopSurface: (surfaceId: RootTag) => void;
  enqueueNativeEvent: (
    shadowNode: unknown /* ShadowNode */,
    type: string,
    payload?: unknown,
    category?: NativeEventCategory,
    isUnique?: boolean,
  ) => void;
  enqueueScrollEvent: (
    shadowNode: unknown /* ShadowNode */,
    options: ScrollOptions,
  ) => void;
  enqueueModalSizeUpdate: (
    shadowNode: unknown /* ShadowNode */,
    height: number,
    width: number,
  ) => void;
  takeMountingManagerLogs: (surfaceId: RootTag) => Array<string>;
  getDirectManipulationProps: (
    shadowNode: unknown /* ShadowNode */,
  ) => Readonly<{
    [key: string]: unknown;
  }>;
  getFabricUpdateProps: (shadowNode: unknown /* ShadowNode */) => Readonly<{
    [key: string]: unknown;
  }>;
  flushMessageQueue: () => void;
  flushEventQueue: () => void;
  produceFramesForDuration: (miliseconds: number) => void;
  validateEmptyMessageQueue: () => void;
  getRenderedOutput: (
    surfaceId: RootTag,
    config: RenderFormatOptions,
  ) => string;
  reportTestSuiteResultsJSON: (results: string) => void;
  // Added by react-native-a11y-tree (not in upstream Fantom): typed JSON dump
  // of the committed ShadowTree for a surface. Optional: older hosts do not
  // implement it, so check `typeof NativeFantom.getA11yTree === 'function'`.
  getA11yTree?: (
    surfaceId: RootTag,
    includeDebugProps?: boolean | null,
    includeMountedProps?: boolean | null,
  ) => string;
  // Also added by react-native-a11y-tree and optional (check with `typeof`).
  // JSON `{"tag", "type", "path", "viaHitSlop"}` or `null`.
  hitTest?: (surfaceId: RootTag, x: number, y: number) => string;
  enqueueNativeEventByTag?: (
    surfaceId: RootTag,
    tag: number,
    type: string,
    payload?: unknown,
    category?: NativeEventCategory,
    isUnique?: boolean,
  ) => void;
  enqueueScrollEventByTag?: (
    surfaceId: RootTag,
    tag: number,
    options: ScrollOptions,
  ) => void;
  setTextInputTextByTag?: (surfaceId: RootTag, tag: number, text: string) => void;
  // Returns the number of state updates.
  updateNativeStates?: (surfaceId: RootTag) => number;
  getShadowTreeRevision?: (surfaceId: RootTag) => number;
  getMountedRevision?: (surfaceId: RootTag) => number;
  setScreensHeaderHeight?: (headerHeight: number) => void;
  setSafeAreaInsets?: (insets: EdgeInsets) => void;
  setDeviceMetrics?: (metrics: DeviceMetrics) => void;
  dispatchExpoModifierEvent?: (tag: number, type: string, params?: unknown) => void;
  // JSON array of the host's feature strings.
  getCapabilities?: () => string;
  // JSON {protocolVersion, rnVersion, buildType, sanitize, engines, fonts}.
  getHostInfo?: () => string;
  hasNativeComponent?: (name: string) => boolean;
  createShadowNodeReferenceCounter(
    shadowNode: unknown /* ShadowNode */,
  ): () => number;
  createShadowNodeRevisionGetter(
    shadowNode: unknown /* ShadowNode */,
  ): () => number | null | undefined;
  saveJSMemoryHeapSnapshot: (filePath: string) => void;
  forceHighResTimeStamp: (timeStamp: number | null | undefined) => void;
  setTimerMockEnabled: (enabled: boolean) => void;
  advanceTimers: (deltaMs: number) => void;
  runAllTimers: () => void;
  getPendingTimerCount: () => number;
  startJSSamplingProfiler: () => void;
  stopJSSamplingProfilerAndSaveToFile: (filePath: string) => void;
  setImageResponse(uri: string, imageResponse: ImageResponse): void;
  clearImage(uri: string): void;
  clearAllImages(): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>(
  'NativeFantomCxx',
) as Spec;
