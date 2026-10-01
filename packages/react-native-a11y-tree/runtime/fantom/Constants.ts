/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export type HostPlatform = 'android' | 'windows' | 'macos' | 'linux';

export type FantomRuntimeConstants = Readonly<{
  isOSS: boolean;
  isRunningFromCI: boolean;
  runBenchmarks: boolean;
  fantomConfigSummary: string;
  jsHeapSnapshotOutputPathTemplate: string;
  jsHeapSnapshotOutputPathTemplateToken: string;
  jsTraceOutputPath: string | null | undefined;
  hostPlatform: HostPlatform;
}>;

let constants: FantomRuntimeConstants = {
  isOSS: false,
  isRunningFromCI: false,
  runBenchmarks: false,
  fantomConfigSummary: '',
  jsHeapSnapshotOutputPathTemplate: '',
  jsHeapSnapshotOutputPathTemplateToken: '',
  jsTraceOutputPath: null,
  hostPlatform: 'linux',
};

export function getConstants(): FantomRuntimeConstants {
  return constants;
}

export function setConstants(newConstants: FantomRuntimeConstants): void {
  constants = newConstants;
}
