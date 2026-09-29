/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/core/ShadowNode.h>
#include <react/renderer/graphics/Point.h>

#include <optional>
#include <vector>

namespace facebook::react {

struct HitTestResult {
  std::shared_ptr<const ShadowNode> node;
  // Tags from the root to `node` (both included).
  std::vector<Tag> path;
  // True if `LayoutableShadowNode::findNodeAtPoint` (no hitSlop) gives a
  // different node, i.e. the result comes from a `hitSlop` area.
  bool viaHitSlop{false};
};

/*
 * Finds the touch target at `point` (in root coordinates).
 *
 * Same algorithm as `LayoutableShadowNode::findNodeAtPoint` (pointerEvents via
 * canBeTouchTarget/canChildrenBeTouchTarget, transforms, overflow insets,
 * ScrollView content offset, children in reverse zIndex order), but a node's
 * own bounds are extended by its `hitSlop` like on Android (TouchTargetHelper)
 * and iOS (pointInside). Nodes with `display: none` are skipped.
 */
std::optional<HitTestResult> hitTest(const std::shared_ptr<const ShadowNode> &rootShadowNode, Point point);

/*
 * Returns the node with `tag` in the tree, or nullptr.
 */
std::shared_ptr<const ShadowNode> findShadowNodeByTag(const std::shared_ptr<const ShadowNode> &rootShadowNode, Tag tag);

} // namespace facebook::react
