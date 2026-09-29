/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/textinput/BaseTextInputProps.h>
#include <react/renderer/components/textinput/BaseTextInputShadowNode.h>
#include <react/renderer/components/textinput/TextInputEventEmitter.h>
#include <react/renderer/components/textinput/TextInputState.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>

namespace facebook::react {

extern const char FantomAndroidTextInputComponentName[];

/*
 * Props for <AndroidTextInput>. ReactCommon's `AndroidTextInputProps` only
 * compiles with RN_SERIALIZABLE_STATE (Android), so this is the cross-platform
 * `BaseTextInputProps` plus the Android props that the a11y tree reports.
 */
class FantomAndroidTextInputProps final : public BaseTextInputProps {
 public:
  FantomAndroidTextInputProps() = default;
  FantomAndroidTextInputProps(
      const PropsParserContext &context,
      const FantomAndroidTextInputProps &sourceProps,
      const RawProps &rawProps);

  void
  setProp(const PropsParserContext &context, RawPropsPropNameHash hash, const char *propName, const RawValue &value);

  bool secureTextEntry{false};
};

/*
 * `ShadowNode` for <AndroidTextInput> in the Fantom tester.
 *
 * The JS bundle uses the Android TextInput implementation, which renders the
 * `AndroidTextInput` native component. ReactCommon's
 * `AndroidTextInputShadowNode` and its descriptor need JNI and the Android
 * TextLayoutManager API (`measureCachedSpannableById`, `measureLines`), so this
 * node uses the cross-platform `BaseTextInputShadowNode` (the same base as the
 * iOS `TextInputShadowNode`). It measures the text (or
 * the placeholder) with the platform `TextLayoutManager`.
 *
 * Not modelled: the Android theme padding of `EditText` (the Android
 * descriptor reads it through JNI), so the node has no default padding.
 */
class FantomAndroidTextInputShadowNode final : public BaseTextInputShadowNode<
                                                   FantomAndroidTextInputComponentName,
                                                   FantomAndroidTextInputProps,
                                                   TextInputEventEmitter,
                                                   TextInputState> {
 public:
  using BaseTextInputShadowNode::BaseTextInputShadowNode;
};

class FantomAndroidTextInputComponentDescriptor final
    : public ConcreteComponentDescriptor<FantomAndroidTextInputShadowNode> {
 public:
  explicit FantomAndroidTextInputComponentDescriptor(const ComponentDescriptorParameters &parameters)
      : ConcreteComponentDescriptor<FantomAndroidTextInputShadowNode>(parameters),
        textLayoutManager_(std::make_shared<TextLayoutManager>(contextContainer_))
  {
  }

 protected:
  void adopt(ShadowNode &shadowNode) const override
  {
    ConcreteComponentDescriptor::adopt(shadowNode);

    auto &concreteShadowNode = static_cast<FantomAndroidTextInputShadowNode &>(shadowNode);
    concreteShadowNode.setTextLayoutManager(textLayoutManager_);
  }

 private:
  const std::shared_ptr<TextLayoutManager> textLayoutManager_;
};

} // namespace facebook::react
