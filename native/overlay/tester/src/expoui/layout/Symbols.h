// SF Symbol sizes on iOS: UIImage(systemName:withConfiguration:) sizes, which equal SwiftUI's
// Image(systemName:) frames (checked for all names at 17 pt regular and semibold).
// Generated from native/tools/swiftui-ref/scripts/run-ios.sh (SWIFTUI_REF_SYMBOLS=...) on the
// iOS 26.5 simulator (scale 3); see native/tools/swiftui-layout-test/README.md.

#pragma once

#include <optional>
#include <string>

#include "Layout.h"

namespace expoui::layout {

/// Size of `Image(systemName: name)` on iOS at `pointSize` and `weight`, or nullopt for a name
/// that is not in the table. Exact at the measured point sizes (11, 12, 13, 15, 16, 17, 20, 22,
/// 28, 34, 48, 64, 100: every text style size); between them linearly interpolated and rounded
/// up to 1/3 pt (off by up to 2/3 pt). Weights: regular and semibold measured; lighter weights
/// use regular, heavier ones semibold.
std::optional<Size> iosSymbolSize(const std::string& name, double pointSize, const std::string& weight);

} // namespace expoui::layout
