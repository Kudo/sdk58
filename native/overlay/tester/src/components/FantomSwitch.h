/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/FBReactNativeSpec/EventEmitters.h>
#include <react/renderer/components/FBReactNativeSpec/Props.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/LayoutContext.h>

namespace facebook::react {

extern const char FantomAndroidSwitchComponentName[];

/*
 * `ShadowNode` for <AndroidSwitch> in the Fantom tester.
 *
 * ReactCommon's `AndroidSwitchShadowNode` measures the native Android switch
 * through JNI. There is no native view here, so the switch has a fixed
 * intrinsic size: 51x31, the intrinsic size of UISwitch on iOS. Explicit
 * width/height styles still take precedence (Yoga only measures nodes without
 * a definite size).
 */
class FantomAndroidSwitchShadowNode final : public ConcreteViewShadowNode<
                                                FantomAndroidSwitchComponentName,
                                                AndroidSwitchProps,
                                                AndroidSwitchEventEmitter> {
 public:
  static constexpr Size kIntrinsicSize{.width = 51, .height = 31};

  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  static ShadowNodeTraits BaseTraits()
  {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    return traits;
  }

  Size measureContent(const LayoutContext & /*layoutContext*/, const LayoutConstraints &layoutConstraints)
      const override
  {
    return layoutConstraints.clamp(kIntrinsicSize);
  }
};

using FantomAndroidSwitchComponentDescriptor = ConcreteComponentDescriptor<FantomAndroidSwitchShadowNode>;

} // namespace facebook::react
