/*
 * Fonts compiled into the host executable (native/fonts/): Roboto, inflated
 * and parsed by the portable text layout (PortableFonts.h). Same API as
 * platform/macos/EmbeddedFonts.h.
 */

#pragma once

namespace facebook::react {

/// Inflates and parses the embedded fonts, once. Safe to call from any thread
/// and many times. Returns the number of faces loaded (0 when the build has no
/// embedded fonts).
int registerEmbeddedFonts();

} // namespace facebook::react
