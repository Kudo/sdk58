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

} // namespace facebook::react
