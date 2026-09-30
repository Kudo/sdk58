/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "A11yTree.h"

#include <react/renderer/attributedstring/conversions.h>
#include <react/renderer/components/image/ImageProps.h>
#include <react/renderer/components/legacyviewmanagerinterop/LegacyViewManagerInteropViewProps.h>
#include <react/renderer/components/scrollview/ScrollViewProps.h>
#include <react/renderer/components/scrollview/ScrollViewShadowNode.h>
#include <react/renderer/components/text/BaseTextShadowNode.h>
#include <react/renderer/components/text/ParagraphProps.h>
#include <react/renderer/components/text/RawTextProps.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/components/view/accessibilityPropsConversions.h>
#include <react/renderer/core/LayoutableShadowNode.h>
#include <yoga/style/Style.h>

#include "components/FantomSafeArea.h"
#include "components/FantomSwitch.h"
#ifdef FANTOM_WITH_RNSCREENS
#include <react/renderer/components/rnscreens/Props.h>
#include <react/renderer/components/rnscreens/RNSScreenShadowNode.h>
#endif
#ifdef FANTOM_WITH_SAFEAREACONTEXT
#include <react/renderer/components/safeareacontext/RNCSafeAreaViewShadowNode.h>
#endif
#ifdef FANTOM_WITH_RNGESTUREHANDLER
#include <react/renderer/components/rngesturehandler_codegen/Props.h>
#endif
#include "components/FantomTextInput.h"

#include <cmath>
#include <cstring>
#include <iomanip>
#include <sstream>
#include <unordered_map>

namespace facebook::react {

namespace {

folly::dynamic number(Float value) {
  // JSON cannot represent NaN or infinity.
  if (!std::isfinite(value)) {
    return nullptr;
  }
  return static_cast<double>(value);
}

std::string colorToString(const SharedColor& color) {
  std::ostringstream stream;
  stream << "rgba(" << static_cast<int>(redFromColor(color)) << ", "
         << static_cast<int>(greenFromColor(color)) << ", "
         << static_cast<int>(blueFromColor(color)) << ", "
         << std::setprecision(3) << (alphaFromColor(color) / 255.0) << ")";
  return stream.str();
}

const char* layoutDirectionToString(LayoutDirection layoutDirection) {
  switch (layoutDirection) {
    case LayoutDirection::Undefined:
      return "undefined";
    case LayoutDirection::LeftToRight:
      return "ltr";
    case LayoutDirection::RightToLeft:
      return "rtl";
  }
  return "undefined";
}

const char* pointerEventsToString(PointerEventsMode pointerEvents) {
  switch (pointerEvents) {
    case PointerEventsMode::Auto:
      return "auto";
    case PointerEventsMode::None:
      return "none";
    case PointerEventsMode::BoxNone:
      return "box-none";
    case PointerEventsMode::BoxOnly:
      return "box-only";
  }
  return "auto";
}

const char* checkedToString(AccessibilityState::CheckedState checked) {
  switch (checked) {
    case AccessibilityState::Unchecked:
      return "unchecked";
    case AccessibilityState::Checked:
      return "checked";
    case AccessibilityState::Mixed:
      return "mixed";
    case AccessibilityState::None:
      return "none";
  }
  return "none";
}

folly::dynamic edgeInsetsToDynamic(const EdgeInsets& insets) {
  return folly::dynamic::object("top", number(insets.top))(
      "left", number(insets.left))("right", number(insets.right))(
      "bottom", number(insets.bottom));
}

folly::dynamic rectToDynamic(const Rect& rect) {
  return folly::dynamic::object("x", number(rect.origin.x))(
      "y", number(rect.origin.y))("width", number(rect.size.width))(
      "height", number(rect.size.height));
}

template <typename T, typename F>
folly::dynamic edgesToDynamic(const RectangleEdges<T>& edges, F convert) {
  if (edges.isUniform()) {
    return convert(edges.left);
  }
  return folly::dynamic::object("left", convert(edges.left))(
      "top", convert(edges.top))("right", convert(edges.right))(
      "bottom", convert(edges.bottom));
}

#pragma mark - Yoga style

folly::dynamic lengthToDynamic(const yoga::StyleLength& length) {
  if (length.isUndefined()) {
    return nullptr;
  }
  if (length.isAuto()) {
    return "auto";
  }
  auto value = length.value().unwrap();
  if (length.isPercent()) {
    return folly::to<std::string>(value) + "%";
  }
  return number(value);
}

folly::dynamic sizeLengthToDynamic(const yoga::StyleSizeLength& length) {
  if (length.isUndefined()) {
    return nullptr;
  }
  if (length.isAuto()) {
    return "auto";
  }
  if (length.isMaxContent()) {
    return "max-content";
  }
  if (length.isFitContent()) {
    return "fit-content";
  }
  if (length.isStretch()) {
    return "stretch";
  }
  auto value = length.value().unwrap();
  if (length.isPercent()) {
    return folly::to<std::string>(value) + "%";
  }
  return number(value);
}

template <typename GetLength>
void addEdges(folly::dynamic& result, const char* name, GetLength getLength) {
  static constexpr std::pair<yoga::Edge, const char*> kEdges[] = {
      {yoga::Edge::Left, "left"},
      {yoga::Edge::Top, "top"},
      {yoga::Edge::Right, "right"},
      {yoga::Edge::Bottom, "bottom"},
      {yoga::Edge::Start, "start"},
      {yoga::Edge::End, "end"},
      {yoga::Edge::Horizontal, "horizontal"},
      {yoga::Edge::Vertical, "vertical"},
      {yoga::Edge::All, "all"},
  };
  folly::dynamic edges = folly::dynamic::object();
  for (const auto& [edge, edgeName] : kEdges) {
    auto value = lengthToDynamic(getLength(edge));
    if (!value.isNull()) {
      edges[edgeName] = value;
    }
  }
  if (!edges.empty()) {
    result[name] = edges;
  }
}

folly::dynamic yogaStyleToDynamic(const yoga::Style& style) {
  static const yoga::Style kDefault{};
  folly::dynamic result = folly::dynamic::object();

#define A11Y_TREE_ENUM(name)                    \
  if (style.name() != kDefault.name()) {        \
    result[#name] = yoga::toString(style.name()); \
  }
  A11Y_TREE_ENUM(direction)
  A11Y_TREE_ENUM(flexDirection)
  A11Y_TREE_ENUM(justifyContent)
  A11Y_TREE_ENUM(alignContent)
  A11Y_TREE_ENUM(alignItems)
  A11Y_TREE_ENUM(alignSelf)
  A11Y_TREE_ENUM(positionType)
  A11Y_TREE_ENUM(flexWrap)
  A11Y_TREE_ENUM(overflow)
  A11Y_TREE_ENUM(display)
  A11Y_TREE_ENUM(boxSizing)
#undef A11Y_TREE_ENUM

#define A11Y_TREE_FLOAT(name)                      \
  if (!style.name().isUndefined()) {               \
    result[#name] = number(style.name().unwrap()); \
  }
  A11Y_TREE_FLOAT(flex)
  A11Y_TREE_FLOAT(flexGrow)
  A11Y_TREE_FLOAT(flexShrink)
  A11Y_TREE_FLOAT(aspectRatio)
#undef A11Y_TREE_FLOAT

  auto addSize = [&](const char* name,
                     const yoga::StyleSizeLength& length,
                     const yoga::StyleSizeLength& defaultLength) {
    if (length == defaultLength) {
      return;
    }
    auto value = sizeLengthToDynamic(length);
    if (!value.isNull()) {
      result[name] = value;
    }
  };
  addSize("flexBasis", style.flexBasis(), kDefault.flexBasis());
  for (auto dimension : {yoga::Dimension::Width, yoga::Dimension::Height}) {
    bool isWidth = dimension == yoga::Dimension::Width;
    addSize(
        isWidth ? "width" : "height",
        style.dimension(dimension),
        kDefault.dimension(dimension));
    addSize(
        isWidth ? "minWidth" : "minHeight",
        style.minDimension(dimension),
        kDefault.minDimension(dimension));
    addSize(
        isWidth ? "maxWidth" : "maxHeight",
        style.maxDimension(dimension),
        kDefault.maxDimension(dimension));
  }

  addEdges(result, "margin", [&](yoga::Edge edge) { return style.margin(edge); });
  addEdges(result, "padding", [&](yoga::Edge edge) { return style.padding(edge); });
  addEdges(result, "position", [&](yoga::Edge edge) { return style.position(edge); });
  addEdges(result, "border", [&](yoga::Edge edge) { return style.border(edge); });

  folly::dynamic gap = folly::dynamic::object();
  for (const auto& [gutter, gutterName] :
       {std::pair{yoga::Gutter::Column, "column"},
        std::pair{yoga::Gutter::Row, "row"},
        std::pair{yoga::Gutter::All, "all"}}) {
    auto value = lengthToDynamic(style.gap(gutter));
    if (!value.isNull()) {
      gap[gutterName] = value;
    }
  }
  if (!gap.empty()) {
    result["gap"] = gap;
  }

  return result;
}

#pragma mark - View props

void addViewProps(
    folly::dynamic& result,
    const BaseViewProps& props,
    const LayoutMetrics* layoutMetrics) {
  static const BaseViewProps kDefault{};

  if (props.accessible) {
    result["accessible"] = true;
  }
  if (!props.accessibilityLabel.empty()) {
    result["accessibilityLabel"] = props.accessibilityLabel;
  }
  if (!props.accessibilityHint.empty()) {
    result["accessibilityHint"] = props.accessibilityHint;
  }
  if (!props.accessibilityRole.empty()) {
    result["accessibilityRole"] = props.accessibilityRole;
  }
  if (props.role != Role::None) {
    result["role"] = toString(props.role);
  }
  if (props.accessibilityState.has_value()) {
    const auto& state = props.accessibilityState.value();
    folly::dynamic stateObject = folly::dynamic::object("disabled", state.disabled)(
        "selected", state.selected)("busy", state.busy);
    if (state.checked != AccessibilityState::None) {
      stateObject["checked"] = checkedToString(state.checked);
    }
    if (state.expanded.has_value()) {
      stateObject["expanded"] = state.expanded.value();
    }
    result["accessibilityState"] = stateObject;
  }
  {
    const auto& value = props.accessibilityValue;
    folly::dynamic valueObject = folly::dynamic::object();
    if (value.min.has_value()) {
      valueObject["min"] = value.min.value();
    }
    if (value.max.has_value()) {
      valueObject["max"] = value.max.value();
    }
    if (value.now.has_value()) {
      valueObject["now"] = value.now.value();
    }
    if (value.text.has_value()) {
      valueObject["text"] = value.text.value();
    }
    if (!valueObject.empty()) {
      result["accessibilityValue"] = valueObject;
    }
  }
  if (!props.accessibilityActions.empty()) {
    folly::dynamic actions = folly::dynamic::array();
    for (const auto& action : props.accessibilityActions) {
      actions.push_back(action.name);
    }
    result["accessibilityActions"] = actions;
  }
  if (props.importantForAccessibility != ImportantForAccessibility::Auto) {
    result["importantForAccessibility"] = toString(props.importantForAccessibility);
  }
  if (props.accessibilityElementsHidden) {
    result["accessibilityElementsHidden"] = true;
  }
  if (props.accessibilityViewIsModal) {
    result["accessibilityViewIsModal"] = true;
  }
  if (props.accessibilityLiveRegion != AccessibilityLiveRegion::None) {
    result["accessibilityLiveRegion"] = toString(props.accessibilityLiveRegion);
  }
  if (!props.accessibilityLabelledBy.value.empty()) {
    folly::dynamic labelledBy = folly::dynamic::array();
    for (const auto& id : props.accessibilityLabelledBy.value) {
      labelledBy.push_back(id);
    }
    result["accessibilityLabelledBy"] = labelledBy;
  }
  if (!props.accessibilityLanguage.empty()) {
    result["accessibilityLanguage"] = props.accessibilityLanguage;
  }
  if (!props.testId.empty()) {
    result["testID"] = props.testId;
  }
  if (!props.nativeId.empty()) {
    result["nativeID"] = props.nativeId;
  }
  if (!props.collapsable) {
    result["collapsable"] = false;
  }
  if (props.pointerEvents != PointerEventsMode::Auto) {
    result["pointerEvents"] = pointerEventsToString(props.pointerEvents);
  }
  if (props.opacity != kDefault.opacity) {
    result["opacity"] = number(props.opacity);
  }
  if (props.backgroundColor) {
    result["backgroundColor"] = colorToString(props.backgroundColor);
  }
  if (props.zIndex.has_value()) {
    result["zIndex"] = props.zIndex.value();
  }

  if (layoutMetrics != nullptr) {
    auto borderMetrics = props.resolveBorderMetrics(*layoutMetrics);
    const auto& colors = borderMetrics.borderColors;
    if (colors.left || colors.top || colors.right || colors.bottom) {
      result["borderColors"] = edgesToDynamic(colors, [](const SharedColor& c) {
        return c ? folly::dynamic(colorToString(c)) : folly::dynamic(nullptr);
      });
    }
    const auto& widths = borderMetrics.borderWidths;
    if (widths.left != 0 || widths.top != 0 || widths.right != 0 ||
        widths.bottom != 0) {
      result["borderWidths"] =
          edgesToDynamic(widths, [](Float value) { return number(value); });
    }
    const auto& radii = borderMetrics.borderRadii;
    if (radii != BorderRadii{}) {
      auto corner = [](const CornerRadii& r) {
        return r.horizontal == r.vertical
            ? number(r.horizontal)
            : folly::dynamic::object("horizontal", number(r.horizontal))(
                  "vertical", number(r.vertical));
      };
      result["borderRadii"] = radii.isUniform()
          ? corner(radii.topLeft)
          : folly::dynamic::object("topLeft", corner(radii.topLeft))(
                "topRight", corner(radii.topRight))(
                "bottomLeft", corner(radii.bottomLeft))(
                "bottomRight", corner(radii.bottomRight));
    }

    auto transform = props.resolveTransform(*layoutMetrics);
    if (transform.matrix != Transform::Identity().matrix) {
      folly::dynamic matrix = folly::dynamic::array();
      for (auto value : transform.matrix) {
        matrix.push_back(number(value));
      }
      result["transform"] = matrix;
    }
  }

  auto yogaStyle = yogaStyleToDynamic(props.yogaStyle);
  if (!yogaStyle.empty()) {
    result["yogaStyle"] = yogaStyle;
  }
}

#pragma mark - Text

folly::dynamic textAttributesToDynamic(const TextAttributes& attributes) {
  folly::dynamic result = folly::dynamic::object();
  if (!std::isnan(attributes.fontSize)) {
    result["fontSize"] = number(attributes.fontSize);
  }
  if (attributes.fontWeight.has_value()) {
    result["fontWeight"] = static_cast<int>(attributes.fontWeight.value());
  }
  if (attributes.fontStyle.has_value()) {
    result["fontStyle"] = toString(attributes.fontStyle.value());
  }
  if (!attributes.fontFamily.empty()) {
    result["fontFamily"] = attributes.fontFamily;
  }
  if (attributes.foregroundColor) {
    result["color"] = colorToString(attributes.foregroundColor);
  }
  if (!std::isnan(attributes.lineHeight)) {
    result["lineHeight"] = number(attributes.lineHeight);
  }
  if (!std::isnan(attributes.letterSpacing)) {
    result["letterSpacing"] = number(attributes.letterSpacing);
  }
  if (attributes.alignment.has_value()) {
    result["textAlign"] = toString(attributes.alignment.value());
  }
  if (attributes.textDecorationLineType.has_value() &&
      attributes.textDecorationLineType.value() !=
          TextDecorationLineType::None) {
    result["textDecorationLine"] =
        toString(attributes.textDecorationLineType.value());
  }
  if (attributes.textTransform.has_value() &&
      attributes.textTransform.value() != TextTransform::None) {
    result["textTransform"] = toString(attributes.textTransform.value());
  }
  return result;
}

void addParagraph(
    folly::dynamic& result,
    const ShadowNode& node,
    const ParagraphProps& props) {
  // Same construction as ParagraphShadowNode::getContent, so the fragments
  // carry fully resolved text attributes (including platform defaults).
  auto baseTextAttributes = TextAttributes::defaultTextAttributes();
  baseTextAttributes.apply(props.textAttributes);
  AttributedString attributedString;
  BaseTextShadowNode::Attachments attachments;
  BaseTextShadowNode::buildAttributedString(
      baseTextAttributes, node, attributedString, attachments);

  std::string text;
  folly::dynamic fragments = folly::dynamic::array();
  for (const auto& fragment : attributedString.getFragments()) {
    folly::dynamic fragmentObject = textAttributesToDynamic(fragment.textAttributes);
    if (fragment.isAttachment()) {
      fragmentObject["attachment"] = true;
      fragmentObject["tag"] = fragment.parentShadowView.tag;
    } else {
      fragmentObject["text"] = fragment.string;
      text += fragment.string;
    }
    fragments.push_back(std::move(fragmentObject));
  }
  result["text"] = text;
  result["fragments"] = fragments;

  const auto& paragraphAttributes = props.paragraphAttributes;
  folly::dynamic paragraph = folly::dynamic::object();
  if (paragraphAttributes.maximumNumberOfLines > 0) {
    paragraph["numberOfLines"] = paragraphAttributes.maximumNumberOfLines;
  }
  paragraph["ellipsizeMode"] = toString(paragraphAttributes.ellipsizeMode);
  if (paragraphAttributes.adjustsFontSizeToFit) {
    paragraph["adjustsFontSizeToFit"] = true;
  }
  result["paragraphAttributes"] = paragraph;
}

#pragma mark - Other components

void addLegacyInteropProps(folly::dynamic& result, const folly::dynamic& otherProps) {
  if (!otherProps.isObject()) {
    return;
  }
  static constexpr const char* kKeys[] = {
      "text",
      "defaultValue",
      "placeholder",
      "editable",
      "secureTextEntry",
      "value",
      "on",
      "enabled",
      "multiline",
  };
  for (const auto* key : kKeys) {
    auto it = otherProps.find(key);
    if (it != otherProps.items().end() && !it->second.isNull()) {
      result[key] = it->second;
    }
  }
}

using MountedViews = std::unordered_map<Tag, const StubView*>;

void collectMountedViews(const StubView& view, MountedViews& views) {
  views[view.tag] = &view;
  for (const auto& child : view.children) {
    collectMountedViews(*child, views);
  }
}

bool framesEqual(const Rect& lhs, const Rect& rhs) {
  constexpr Float kEpsilon = 0.001;
  return std::abs(lhs.origin.x - rhs.origin.x) < kEpsilon &&
      std::abs(lhs.origin.y - rhs.origin.y) < kEpsilon &&
      std::abs(lhs.size.width - rhs.size.width) < kEpsilon &&
      std::abs(lhs.size.height - rhs.size.height) < kEpsilon;
}

/*
 * Mounted values that differ from the shadow node: opacity, transform,
 * backgroundColor and frame. The frame is only compared when the mounted
 * parent is the shadow parent (flattened ancestors change the mounted
 * frame's origin).
 */
folly::dynamic mountedDifferences(
    const ShadowNode& node,
    const LayoutMetrics* layoutMetrics,
    Tag parentTag,
    const MountedViews& mountedViews) {
  auto it = mountedViews.find(node.getTag());
  if (it == mountedViews.end()) {
    return nullptr;
  }
  const auto& mountedView = *it->second;
  folly::dynamic mounted = folly::dynamic::object();

  const auto* props = dynamic_cast<const BaseViewProps*>(node.getProps().get());
  const auto* mountedProps =
      dynamic_cast<const BaseViewProps*>(mountedView.props.get());
  if (props != nullptr && mountedProps != nullptr && props != mountedProps) {
    if (props->opacity != mountedProps->opacity) {
      mounted["opacity"] = number(mountedProps->opacity);
    }
    if (props->backgroundColor != mountedProps->backgroundColor) {
      mounted["backgroundColor"] = mountedProps->backgroundColor
          ? folly::dynamic(colorToString(mountedProps->backgroundColor))
          : folly::dynamic(nullptr);
    }
    if (layoutMetrics != nullptr) {
      auto transform = props->resolveTransform(*layoutMetrics);
      auto mountedTransform =
          mountedProps->resolveTransform(mountedView.layoutMetrics);
      if (transform.matrix != mountedTransform.matrix) {
        folly::dynamic matrix = folly::dynamic::array();
        for (auto value : mountedTransform.matrix) {
          matrix.push_back(number(value));
        }
        mounted["transform"] = matrix;
      }
    }
  }

  if (layoutMetrics != nullptr && mountedView.parentTag == parentTag &&
      !framesEqual(layoutMetrics->frame, mountedView.layoutMetrics.frame)) {
    mounted["frame"] = rectToDynamic(mountedView.layoutMetrics.frame);
  }

  return mounted.empty() ? folly::dynamic(nullptr) : mounted;
}

// Color with float components (0-255 for rgb, 0-1 for alpha).
struct Rgba {
  double r{0};
  double g{0};
  double b{0};
  double a{0};
};

// The window background the composition starts from (white, like the default
// window background of both platforms).
constexpr Rgba kWindowBackground{255, 255, 255, 1};

// Source-over compositing of `color` on top of `below`.
Rgba compositeOver(const Rgba& below, const SharedColor& color) {
  if (!color) {
    return below;
  }
  Rgba top{
      static_cast<double>(redFromColor(color)),
      static_cast<double>(greenFromColor(color)),
      static_cast<double>(blueFromColor(color)),
      alphaFromColor(color) / 255.0};
  double a = top.a + below.a * (1 - top.a);
  if (a <= 0) {
    return Rgba{};
  }
  auto channel = [&](double topChannel, double belowChannel) {
    return (topChannel * top.a + belowChannel * below.a * (1 - top.a)) / a;
  };
  return Rgba{
      channel(top.r, below.r), channel(top.g, below.g), channel(top.b, below.b), a};
}

std::string rgbaToString(const Rgba& color) {
  std::ostringstream stream;
  stream << "rgba(" << static_cast<int>(std::lround(color.r)) << ", "
         << static_cast<int>(std::lround(color.g)) << ", "
         << static_cast<int>(std::lround(color.b)) << ", "
         << std::setprecision(3) << color.a << ")";
  return stream.str();
}

// The node's background color: the mounted one when it differs (for example a
// Reanimated animation), else the shadow node's.
SharedColor backgroundColorOf(
    const ShadowNode& node,
    const MountedViews* mountedViews) {
  SharedColor color;
  if (const auto* props =
          dynamic_cast<const BaseViewProps*>(node.getProps().get())) {
    color = props->backgroundColor;
  }
  if (mountedViews != nullptr) {
    auto it = mountedViews->find(node.getTag());
    if (it != mountedViews->end()) {
      if (const auto* mountedProps =
              dynamic_cast<const BaseViewProps*>(it->second->props.get())) {
        color = mountedProps->backgroundColor;
      }
    }
  }
  return color;
}

folly::dynamic renderNode(
    const ShadowNode& node,
    const A11yTreeOptions& options,
    const MountedViews* mountedViews,
    Tag parentTag,
    bool isRoot,
    const Rgba& parentBackground) {
  folly::dynamic result = folly::dynamic::object("type", node.getComponentName())(
      "tag", node.getTag());

  std::optional<LayoutMetrics> layoutMetricsStorage;
  const LayoutMetrics* layoutMetrics = nullptr;
  if (const auto* layoutable = dynamic_cast<const LayoutableShadowNode*>(&node)) {
    layoutMetricsStorage = layoutable->getLayoutMetrics();
    layoutMetrics = &layoutMetricsStorage.value();
    result["frame"] = rectToDynamic(layoutMetrics->frame);
    result["layoutDirection"] = layoutDirectionToString(layoutMetrics->layoutDirection);
    if (layoutMetrics->displayType == DisplayType::None) {
      result["display"] = "none";
    }
    if (isRoot) {
      result["pointScaleFactor"] = number(layoutMetrics->pointScaleFactor);
    }
    // Offset of the children's coordinate space (ScrollView: -contentOffset;
    // RNSScreen: the header height). Absolute position of a child =
    // parent position + parent contentOriginOffset + child frame origin.
    auto contentOriginOffset = layoutable->getContentOriginOffset(false);
    if (contentOriginOffset.x != 0 || contentOriginOffset.y != 0) {
      result["contentOriginOffset"] = folly::dynamic::object(
          "x", number(contentOriginOffset.x))("y", number(contentOriginOffset.y));
    }
  }

  const auto& props = node.getProps();
  if (const auto* viewProps = dynamic_cast<const BaseViewProps*>(props.get())) {
    addViewProps(result, *viewProps, layoutMetrics);
  }

  if (const auto* paragraphProps = dynamic_cast<const ParagraphProps*>(props.get())) {
    addParagraph(result, node, *paragraphProps);
  } else if (const auto* rawTextProps = dynamic_cast<const RawTextProps*>(props.get())) {
    result["text"] = rawTextProps->text;
  } else if (const auto* imageProps = dynamic_cast<const ImageProps*>(props.get())) {
    folly::dynamic sources = folly::dynamic::array();
    for (const auto& source : imageProps->sources) {
      folly::dynamic sourceObject = folly::dynamic::object("uri", source.uri);
      if (source.size.width > 0 || source.size.height > 0) {
        sourceObject["width"] = number(source.size.width);
        sourceObject["height"] = number(source.size.height);
      }
      sources.push_back(std::move(sourceObject));
    }
    result["sources"] = sources;
  } else if (const auto* scrollViewProps = dynamic_cast<const ScrollViewProps*>(props.get())) {
    if (scrollViewProps->horizontal) {
      result["horizontal"] = true;
    }
    // The state has the current offset (initial `contentOffset` prop, then
    // scroll events); the prop only has the initial value.
    auto contentOffset = scrollViewProps->contentOffset;
    if (const auto* scrollViewShadowNode =
            dynamic_cast<const ScrollViewShadowNode*>(&node)) {
      contentOffset = scrollViewShadowNode->getStateData().contentOffset;
      auto contentSize = scrollViewShadowNode->getStateData().getContentSize();
      result["contentSize"] = folly::dynamic::object(
          "width", number(contentSize.width))(
          "height", number(contentSize.height));
    }
    result["contentOffset"] = folly::dynamic::object(
        "x", number(contentOffset.x))("y", number(contentOffset.y));
  } else if (const auto* textInputProps = dynamic_cast<const FantomAndroidTextInputProps*>(props.get())) {
    result["text"] = getFantomTextInputText(node).value_or(textInputProps->text);
    if (!textInputProps->defaultValue.empty()) {
      result["defaultValue"] = textInputProps->defaultValue;
    }
    if (!textInputProps->placeholder.empty()) {
      result["placeholder"] = textInputProps->placeholder;
    }
    result["editable"] = textInputProps->editable;
    result["secureTextEntry"] = textInputProps->secureTextEntry;
    result["multiline"] = textInputProps->multiline;
  } else if (const auto* switchProps = dynamic_cast<const AndroidSwitchProps*>(props.get())) {
    // Android's Switch.js sends the value as `on` (and also `value`).
    result["value"] = switchProps->on || switchProps->value;
    if (!switchProps->enabled || switchProps->disabled) {
      result["disabled"] = true;
    }
  } else if (const auto* interopProps = dynamic_cast<const LegacyViewManagerInteropViewProps*>(props.get())) {
    addLegacyInteropProps(result, interopProps->otherProps);
  }

#ifdef FANTOM_WITH_RNSCREENS
  if (const auto* headerProps =
          dynamic_cast<const RNSScreenStackHeaderConfigProps*>(props.get())) {
    result["title"] = headerProps->title;
    if (headerProps->hidden) {
      result["hidden"] = true;
    }
    if (headerProps->translucent) {
      result["translucent"] = true;
    }
    if (headerProps->largeTitle) {
      result["largeTitle"] = true;
    }
    if (!headerProps->backTitle.empty()) {
      result["backTitle"] = headerProps->backTitle;
    }
    if (headerProps->backgroundColor) {
      result["backgroundColor"] = colorToString(headerProps->backgroundColor);
    }
    if (headerProps->hideBackButton) {
      result["hideBackButton"] = true;
    }
  } else if (
      const auto* screenProps =
          dynamic_cast<const RNSScreenProps*>(props.get())) {
    // 0: inactive, 1: transitioning, 2: active (-1: not set).
    result["activityState"] = number(screenProps->activityState);
    result["stackPresentation"] = toString(screenProps->stackPresentation);
    result["stackAnimation"] = toString(screenProps->stackAnimation);
    result["gestureEnabled"] = screenProps->gestureEnabled;
    if (const auto* screenShadowNode =
            dynamic_cast<const RNSScreenShadowNode*>(&node)) {
      // The emulated native state (see FantomScreens.h).
      const auto& state = screenShadowNode->getStateData();
      result["stateFrameSize"] = folly::dynamic::object(
          "width", number(state.frameSize.width))(
          "height", number(state.frameSize.height));
      result["stateContentOffset"] = folly::dynamic::object(
          "x", number(state.contentOffset.x))(
          "y", number(state.contentOffset.y));
    }
    if (!screenProps->screenId.empty()) {
      result["screenId"] = screenProps->screenId;
    }
  }
#endif

  if (std::strcmp(node.getComponentName(), "RNCSafeAreaProvider") == 0) {
    if (auto insets = getEmittedSafeAreaProviderInsets(node.getTag())) {
      result["insets"] = edgeInsetsToDynamic(*insets);
    }
  }
#ifdef FANTOM_WITH_SAFEAREACONTEXT
  if (const auto* safeAreaView =
          dynamic_cast<const RNCSafeAreaViewShadowNode*>(&node)) {
    result["insets"] = edgeInsetsToDynamic(safeAreaView->getStateData().insets);
  }
#endif

#ifdef FANTOM_WITH_RNGESTUREHANDLER
  if (const auto* detectorProps =
          dynamic_cast<const RNGestureHandlerDetectorProps*>(props.get())) {
    folly::dynamic handlerTags = folly::dynamic::array();
    for (auto handlerTag : detectorProps->handlerTags) {
      handlerTags.push_back(handlerTag);
    }
    result["handlerTags"] = handlerTags;
    result["moduleId"] = detectorProps->moduleId;
    if (!detectorProps->virtualChildren.empty()) {
      folly::dynamic virtualChildren = folly::dynamic::array();
      for (const auto& child : detectorProps->virtualChildren) {
        folly::dynamic handlers = folly::dynamic::array();
        for (auto handlerTag : child.handlerTags) {
          handlers.push_back(handlerTag);
        }
        virtualChildren.push_back(folly::dynamic::object(
            "viewTag", child.viewTag)("handlerTags", handlers));
      }
      result["virtualChildren"] = virtualChildren;
    }
  } else if (
      const auto* rootViewProps =
          dynamic_cast<const RNGestureHandlerRootViewProps*>(props.get())) {
    result["moduleId"] = rootViewProps->moduleId;
  } else if (
      const auto* buttonProps =
          dynamic_cast<const RNGestureHandlerButtonProps*>(props.get())) {
    result["handlerTag"] = buttonProps->handlerTag;
    result["moduleId"] = buttonProps->moduleId;
    result["enabled"] = buttonProps->enabled;
    result["exclusive"] = buttonProps->exclusive;
    if (buttonProps->hasLongPressHandler) {
      result["hasLongPressHandler"] = true;
    }
    if (!buttonProps->gestureTestID.empty()) {
      result["gestureTestID"] = buttonProps->gestureTestID;
    }
    if (buttonProps->rippleColor) {
      result["rippleColor"] = colorToString(buttonProps->rippleColor);
    }
    result["activeOpacity"] = number(buttonProps->activeOpacity);
  }
#endif

  if (mountedViews != nullptr) {
    auto mounted =
        mountedDifferences(node, layoutMetrics, parentTag, *mountedViews);
    if (!mounted.isNull()) {
      result["mounted"] = std::move(mounted);
    }
  }

  // effectiveBackground: the ancestors' and the node's background colors
  // composited over the window background. Emitted on every Paragraph and on
  // layoutable nodes where it differs from the node's own backgroundColor.
  auto ownBackground = backgroundColorOf(node, mountedViews);
  auto effectiveBackground = compositeOver(parentBackground, ownBackground);
  if (layoutMetrics != nullptr) {
    auto effectiveString = rgbaToString(effectiveBackground);
    bool isParagraph =
        dynamic_cast<const ParagraphProps*>(props.get()) != nullptr;
    if (isParagraph ||
        !ownBackground ||
        effectiveString != colorToString(ownBackground)) {
      result["effectiveBackground"] = effectiveString;
    }
  }

#if RN_DEBUG_STRING_CONVERTIBLE
  if (options.includeDebugProps) {
    folly::dynamic debugProps = folly::dynamic::object();
    for (const auto& prop : props->getDebugProps()) {
      if (prop == nullptr) {
        continue;
      }
      debugProps[prop->getDebugName()] = prop->getDebugValue();
    }
    result["debugProps"] = debugProps;
  }
#endif

  const auto& children = node.getChildren();
  if (!children.empty()) {
    folly::dynamic childArray = folly::dynamic::array();
    for (const auto& child : children) {
      childArray.push_back(
          renderNode(
              *child,
              options,
              mountedViews,
              node.getTag(),
              false,
              effectiveBackground));
    }
    result["children"] = childArray;
  }

  return result;
}

} // namespace

folly::dynamic renderA11yTree(
    const ShadowNode& rootShadowNode,
    const A11yTreeOptions& options) {
  if (options.mountedViewTree != nullptr) {
    MountedViews mountedViews;
    collectMountedViews(options.mountedViewTree->getRootStubView(), mountedViews);
    return renderNode(
        rootShadowNode,
        options,
        &mountedViews,
        NO_VIEW_TAG,
        true,
        kWindowBackground);
  }
  return renderNode(
      rootShadowNode, options, nullptr, NO_VIEW_TAG, true, kWindowBackground);
}

} // namespace facebook::react
