/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <folly/dynamic.h>
#include <react/renderer/core/ShadowNode.h>
#include <react/renderer/mounting/stubs/StubViewTree.h>

namespace facebook::react {

struct A11yTreeOptions {
  // Include the raw `getDebugProps()` map of every node as `debugProps`.
  bool includeDebugProps{false};
  // The mounted view tree of the surface. When set, a node whose mounted view
  // differs from the shadow node in opacity, transform, backgroundColor or
  // frame gets `mounted: {...}` with the mounted values (for example
  // Reanimated layout animations, which only change the mounted views).
  const StubViewTree *mountedViewTree{nullptr};
};

/*
 * Serializes a shadow tree (not the mounted view tree, so nothing is flattened
 * or promoted) into a JSON-friendly structure with typed accessibility, layout
 * and style information.
 */
folly::dynamic renderA11yTree(const ShadowNode &rootShadowNode, const A11yTreeOptions &options);

} // namespace facebook::react
