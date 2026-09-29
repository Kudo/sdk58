/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "HitTest.h"

#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/LayoutableShadowNode.h>
#include <react/renderer/graphics/Transform.h>

#include <algorithm>

namespace facebook::react {

namespace {

std::shared_ptr<const ShadowNode> hitTestNode(
    const std::shared_ptr<const ShadowNode>& node,
    Point point,
    bool useHitSlop,
    std::vector<Tag>& path) {
  const auto* layoutableShadowNode =
      dynamic_cast<const LayoutableShadowNode*>(node.get());
  if (layoutableShadowNode == nullptr) {
    return nullptr;
  }

  if (!layoutableShadowNode->canBeTouchTarget() &&
      !layoutableShadowNode->canChildrenBeTouchTarget()) {
    return nullptr;
  }

  auto layoutMetrics = layoutableShadowNode->getLayoutMetrics();
  if (layoutMetrics.displayType == DisplayType::None) {
    return nullptr;
  }

  auto transform = layoutableShadowNode->getTransform();
  auto transformedFrame = layoutMetrics.frame * transform;

  auto hitFrame = layoutMetrics.frame;
  if (useHitSlop) {
    if (const auto* viewProps =
            dynamic_cast<const BaseViewProps*>(node->getProps().get())) {
      hitFrame = outsetBy(hitFrame, viewProps->hitSlop);
    }
  }
  auto isPointInside = (hitFrame * transform).containsPoint(point);

  path.push_back(node->getTag());

  if (isPointInside && !layoutableShadowNode->canChildrenBeTouchTarget()) {
    return node;
  } else if (!isPointInside) {
    auto overflowFrame =
        insetBy(layoutMetrics.frame, layoutMetrics.overflowInset);
    if (!(overflowFrame * transform).containsPoint(point)) {
      path.pop_back();
      return nullptr;
    }
  }

  if (Transform::isVerticalInversion(transform) ||
      Transform::isHorizontalInversion(transform)) {
    auto centerX = transformedFrame.origin.x + transformedFrame.size.width / 2.0;
    auto centerY =
        transformedFrame.origin.y + transformedFrame.size.height / 2.0;
    auto relativeX = point.x - centerX;
    auto relativeY = point.y - centerY;
    if (Transform::isVerticalInversion(transform)) {
      relativeY = -relativeY;
    }
    if (Transform::isHorizontalInversion(transform)) {
      relativeX = -relativeX;
    }
    point.x = float(centerX + relativeX);
    point.y = float(centerY + relativeY);
  }

  auto newPoint = point - transformedFrame.origin -
      layoutableShadowNode->getContentOriginOffset(false);

  auto sortedChildren = node->getChildren();
  std::stable_sort(
      sortedChildren.begin(),
      sortedChildren.end(),
      [](const auto& lhs, const auto& rhs) -> bool {
        return lhs->getOrderIndex() < rhs->getOrderIndex();
      });

  for (auto it = sortedChildren.rbegin(); it != sortedChildren.rend(); it++) {
    auto hitNode = hitTestNode(*it, newPoint, useHitSlop, path);
    if (hitNode) {
      return hitNode;
    }
  }

  // The point may only be inside the overflow area (children); the node
  // itself is only a target if the point is inside its (hitSlop) bounds.
  if (isPointInside && layoutableShadowNode->canBeTouchTarget()) {
    return node;
  }
  path.pop_back();
  return nullptr;
}

} // namespace

std::optional<HitTestResult> hitTest(
    const std::shared_ptr<const ShadowNode>& rootShadowNode,
    Point point) {
  HitTestResult result;
  result.node = hitTestNode(rootShadowNode, point, true, result.path);
  if (result.node == nullptr) {
    return std::nullopt;
  }
  auto rawNode = LayoutableShadowNode::findNodeAtPoint(rootShadowNode, point);
  result.viaHitSlop =
      rawNode == nullptr || rawNode->getTag() != result.node->getTag();
  return result;
}

std::shared_ptr<const ShadowNode> findShadowNodeByTag(
    const std::shared_ptr<const ShadowNode>& rootShadowNode,
    Tag tag) {
  if (rootShadowNode->getTag() == tag) {
    return rootShadowNode;
  }
  for (const auto& child : rootShadowNode->getChildren()) {
    if (auto found = findShadowNodeByTag(child, tag)) {
      return found;
    }
  }
  return nullptr;
}

} // namespace facebook::react
