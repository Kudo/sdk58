/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <folly/dynamic.h>
#include <react/renderer/core/ShadowNode.h>

namespace facebook::react {

struct A11yTreeOptions {
  // Include the raw `getDebugProps()` map of every node as `debugProps`.
  bool includeDebugProps{false};
};

/*
 * Serializes a shadow tree (not the mounted view tree, so nothing is flattened
 * or promoted) into a JSON-friendly structure with typed accessibility, layout
 * and style information.
 */
folly::dynamic renderA11yTree(const ShadowNode &rootShadowNode, const A11yTreeOptions &options);

} // namespace facebook::react
