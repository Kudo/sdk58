/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/iostextinput/TextInputComponentDescriptor.h>
#include <react/renderer/components/textinput/BaseTextInputProps.h>
#include <react/renderer/components/textinput/BaseTextInputShadowNode.h>
#include <react/renderer/components/textinput/TextInputEventEmitter.h>
#include <react/renderer/components/textinput/TextInputState.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>

#include <optional>
#include <string>

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

/*
 * iOS: the JS sends `RCTSinglelineTextInputView` / `RCTMultilineTextInputView`,
 * which Fabric maps to `TextInput` (componentNameByReactViewName). ReactCommon's
 * iOS `TextInputComponentDescriptor` / `TextInputShadowNode` (the same
 * `BaseTextInputShadowNode`, measured with the platform TextLayoutManager) are
 * plain C++ and registered as they are; the two functions below handle both.
 */

/*
 * Sets the text of an uncontrolled <AndroidTextInput> or iOS <TextInput>, like
 * typing on a device. It updates `TextInputState` (the attributed string used for
 * measuring) through `ConcreteState::updateState`, the same path the platform
 * uses for native text changes; the state update is committed by the UIManager
 * when the event queue is flushed, and the new state revision dirties the Yoga
 * measurement, so the node is measured again. `reactTreeAttributedString` is
 * kept, so the next layout does not replace the text with the `text` prop
 * (for a controlled input, a new `text` prop from JS replaces it).
 * Returns false if `shadowNode` is not a text input node.
 */
bool setFantomTextInputText(const ShadowNode &shadowNode, const std::string &text);

/*
 * Returns the current text of a text input node (Android or iOS): the text of its
 * state if the state was updated (typed text), otherwise the `text` prop.
 * Returns std::nullopt for other nodes.
 */
std::optional<std::string> getFantomTextInputText(const ShadowNode &shadowNode);

} // namespace facebook::react
