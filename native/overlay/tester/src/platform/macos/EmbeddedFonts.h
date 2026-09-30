/*
 * Fonts compiled into the host executable (native/fonts/): Roboto, the Android
 * system font, so that Android text (@expo/ui Jetpack Compose, fontFamily
 * "Roboto") is measured with it without files next to the executable.
 */

#pragma once

namespace facebook::react {

/// Inflates the embedded fonts and registers them for this process, once.
/// Safe to call from any thread and many times. Returns the number of faces
/// registered (0 when the build has no embedded fonts).
int registerEmbeddedFonts();

} // namespace facebook::react
