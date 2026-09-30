# Pending CMake hunks (FantomComposeText / embedded Roboto)

`native/overlay/tester/CMakeLists.txt` is being edited by another worker, so
these lines are not applied yet. They were verified in the RN clone
(`private/react-native-fantom/tester/CMakeLists.txt`, Debug build, macOS). Delete
this file once they are in.

## 1. Embedded fonts (after `set(FANTOM_NATIVE_LIBRARIES)`, i.e. after `FANTOM_NODE_MODULES_DIR` is set)

Compiles Roboto (`native/fonts/roboto`) into a `fantom_embedded_fonts` library,
linked into `react_renderer_textlayoutmanager`, as gzip byte arrays and defines `FANTOM_WITH_EMBEDDED_FONTS`, which makes
`TextLayoutManager.mm` register them at startup (`fontFamily: "Roboto"`).

```cmake
# Roboto, the Android system font, compiled into the executable
# (native/fonts/roboto): gzip byte arrays generated at build time by
# cmake/embed-files.cmake, inflated and registered at startup by
# src/platform/macos/EmbeddedFonts.mm.
if(APPLE AND FANTOM_MACOS_TEXT_LAYOUT)
  if(NOT FANTOM_FONTS_DIR)
    get_filename_component(FANTOM_FONTS_DIR "${FANTOM_NODE_MODULES_DIR}/../native/fonts" ABSOLUTE)
  endif()
  set(roboto_names fantom_roboto_regular fantom_roboto_medium fantom_roboto_bold fantom_roboto_italic)
  set(roboto_files
    ${FANTOM_FONTS_DIR}/roboto/Roboto-Regular.ttf
    ${FANTOM_FONTS_DIR}/roboto/Roboto-Medium.ttf
    ${FANTOM_FONTS_DIR}/roboto/Roboto-Bold.ttf
    ${FANTOM_FONTS_DIR}/roboto/Roboto-Italic.ttf)
  set(embedded_font_data ${CMAKE_CURRENT_BINARY_DIR}/generated/EmbeddedFontData.cpp)
  add_custom_command(
    OUTPUT ${embedded_font_data}
    COMMAND ${CMAKE_COMMAND}
      -DOUTPUT=${embedded_font_data}
      -DWORK_DIR=${CMAKE_CURRENT_BINARY_DIR}/generated/fonts
      "-DNAMES=${roboto_names}"
      "-DFILES=${roboto_files}"
      -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/embed-files.cmake
    DEPENDS ${roboto_files}
      ${CMAKE_CURRENT_SOURCE_DIR}/cmake/embed-files.cmake
      ${CMAKE_CURRENT_SOURCE_DIR}/cmake/gzip-file.cmake
    COMMENT "Embedding Roboto"
    VERBATIM)
  # A library in this directory: a custom command's output is only visible to
  # targets of the same directory, and react_renderer_textlayoutmanager is not.
  add_library(fantom_embedded_fonts STATIC
    ${CMAKE_CURRENT_SOURCE_DIR}/src/platform/macos/EmbeddedFonts.mm
    ${embedded_font_data})
  target_compile_options(fantom_embedded_fonts PRIVATE -std=c++20 -Wall -Werror)
  target_link_libraries(fantom_embedded_fonts PUBLIC "-framework CoreText" "-framework Foundation" compression)
  target_link_libraries(react_renderer_textlayoutmanager fantom_embedded_fonts)
  target_include_directories(react_renderer_textlayoutmanager
    PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src/platform/macos)
  target_compile_definitions(react_renderer_textlayoutmanager PRIVATE FANTOM_WITH_EMBEDDED_FONTS=1)
endif()
```

## 2. Compose engine + text adapter in `fantom_tester` (after `add_executable(fantom_tester ...)`)

`src/expoui/layout/Layout.cpp` is needed too (shared types); add it here if the
SwiftUI wiring does not already.

```cmake
if(APPLE AND FANTOM_MACOS_TEXT_LAYOUT)
  target_sources(fantom_tester
    PRIVATE
      ${CMAKE_CURRENT_SOURCE_DIR}/src/expoui/compose/ComposeLayout.cpp
      ${CMAKE_CURRENT_SOURCE_DIR}/src/components/FantomComposeText.mm)
endif()
```

## Size cost

The four faces are 1,426,464 bytes as TTF and 834,099 bytes gzip-compressed.
`EmbeddedFontData.cpp.o` has 837,353 bytes of data, so the executable grows by
about 0.84 MB (about 9% of the 9.25 MB Release host). Inflating and registering
the four faces takes about 6 ms (17 ms on a cold first run); it happens on the
first `fontFamily: "Roboto…"` lookup or the first `FantomComposeTextMeasurer`, not
at startup. Without compression it would be 1.43 MB.

## Verification (RN clone, Debug, with the hunks applied)

- configure with `RN_NATIVE_LIBS_DIR=<repo>/node_modules` and
  `-DFANTOM_FONTS_DIR=<repo>/native/fonts` (the default derives
  `<node_modules>/../native/fonts`, which is right for `yarn build:host`);
- `yarn fantom FantomRoboto` (new, `native/tests/FantomRoboto-itest.js`): "Hello
  world" 14 pt is 70.33 wide with `fontFamily: "Roboto"`, 71.0 with weight 500,
  72.67 with the system font (3x pixel grid);
- `FantomExpoUI` 5/5, `FantomTextProbe` 4/4, `FantomScreens` 2/2 still pass;
- `native/tools/compose-layout-test` builds `FantomComposeText.mm`,
  `EmbeddedFonts.mm` and the generated data (its `build.sh` runs the same
  `embed-files.cmake`) and matches compose-ref exactly (112/112).
