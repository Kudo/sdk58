/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "FantomSwitch.h"
#include "FantomTextInput.h"

#include <react/renderer/core/PropsMacros.h>
#include <react/renderer/core/propsConversions.h>

namespace facebook::react {

extern const char FantomAndroidTextInputComponentName[] = "AndroidTextInput";
extern const char FantomAndroidSwitchComponentName[] = "AndroidSwitch";

FantomAndroidTextInputProps::FantomAndroidTextInputProps(
    const PropsParserContext& context,
    const FantomAndroidTextInputProps& sourceProps,
    const RawProps& rawProps)
    : BaseTextInputProps(context, sourceProps, rawProps),
      secureTextEntry(convertRawProp(
          context,
          rawProps,
          "secureTextEntry",
          sourceProps.secureTextEntry,
          false)) {}

void FantomAndroidTextInputProps::setProp(
    const PropsParserContext& context,
    RawPropsPropNameHash hash,
    const char* propName,
    const RawValue& value) {
  BaseTextInputProps::setProp(context, hash, propName, value);

  static auto defaults = FantomAndroidTextInputProps{};

  switch (hash) {
    RAW_SET_PROP_SWITCH_CASE_BASIC(secureTextEntry);
  }
}

bool setFantomTextInputText(
    const ShadowNode& shadowNode,
    const std::string& text) {
  const auto* textInputShadowNode =
      dynamic_cast<const FantomAndroidTextInputShadowNode*>(&shadowNode);
  if (textInputShadowNode == nullptr) {
    return false;
  }

  const auto& props = textInputShadowNode->getConcreteProps();
  auto textAttributes = props.getEffectiveTextAttributes(
      textInputShadowNode->getLayoutMetrics().fontSizeMultiplier);

  AttributedString attributedString;
  attributedString.setBaseTextAttributes(textAttributes);
  attributedString.appendFragment(
      AttributedString::Fragment{
          .string = text,
          .textAttributes = textAttributes,
          .parentShadowView = shadowViewFromShadowNode(shadowNode)});

  // BaseTextInputShadowNode::updateStateIfNeeded only sets the state during
  // layout if the tree text differs from the state's `reactTreeAttributedString`
  // (for an empty `text` prop both are empty, so the state keeps its initial
  // revision and empty base attributes, and measurement ignores the state).
  // Build the same tree string here so that the state is used for measuring
  // and the next layout keeps it.
  std::optional<AttributedString> reactTreeAttributedString;
  if (shadowNode.getState()->getRevision() == State::initialRevisionValue) {
    AttributedString treeString;
    treeString.appendFragment(
        AttributedString::Fragment{
            .string = props.text,
            .textAttributes = textAttributes,
            .parentShadowView = shadowViewFromShadowNode(shadowNode)});
    auto attachments = BaseTextShadowNode::Attachments{};
    BaseTextShadowNode::buildAttributedString(
        textAttributes, shadowNode, treeString, attachments);
    treeString.setBaseTextAttributes(textAttributes);
    reactTreeAttributedString = std::move(treeString);
  }

  auto state = std::static_pointer_cast<
      const FantomAndroidTextInputShadowNode::ConcreteState>(
      shadowNode.getState());
  state->updateState(
      [attributedString, reactTreeAttributedString](
          const TextInputState& oldData)
          -> std::shared_ptr<const TextInputState> {
        auto newData = oldData;
        newData.attributedStringBox = AttributedStringBox{attributedString};
        if (reactTreeAttributedString.has_value()) {
          newData.reactTreeAttributedString = *reactTreeAttributedString;
        }
        newData.mostRecentEventCount = oldData.mostRecentEventCount + 1;
        return std::make_shared<const TextInputState>(std::move(newData));
      });
  return true;
}

std::optional<std::string> getFantomTextInputText(
    const ShadowNode& shadowNode) {
  const auto* textInputShadowNode =
      dynamic_cast<const FantomAndroidTextInputShadowNode*>(&shadowNode);
  if (textInputShadowNode == nullptr) {
    return std::nullopt;
  }
  if (shadowNode.getState() != nullptr &&
      shadowNode.getState()->getRevision() != State::initialRevisionValue) {
    const auto& box = textInputShadowNode->getStateData().attributedStringBox;
    if (box.getMode() == AttributedStringBox::Mode::Value) {
      return box.getValue().getString();
    }
  }
  return textInputShadowNode->getConcreteProps().text;
}

} // namespace facebook::react
