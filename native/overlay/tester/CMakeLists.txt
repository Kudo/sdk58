# Copyright (c) Meta Platforms, Inc. and affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.

cmake_minimum_required(VERSION 3.13)
set(CMAKE_VERBOSE_MAKEFILE on)
if(UNIX AND NOT APPLE)
  set(CMAKE_POSITION_INDEPENDENT_CODE ON)
endif()

project(fantom_tester)

# FANTOM_TEXT_LAYOUT: the TextLayoutManager that measures <Text> (see below).
#  - macos: CoreText/AppKit (src/platform/macos), Apple only.
#  - portable: stb_truetype and the embedded Roboto (src/platform/portable,
#    third_party/stb), no OS text APIs: builds on any OS.
#  - stub: upstream platform/cxx (every text has the minimum size, height 0).
# Default: macos on Apple (stub with the older FANTOM_MACOS_TEXT_LAYOUT=OFF),
# portable elsewhere.
option(FANTOM_MACOS_TEXT_LAYOUT "Measure text with CoreText/AppKit on macOS (when FANTOM_TEXT_LAYOUT is not set)" ON)
if(APPLE AND FANTOM_MACOS_TEXT_LAYOUT)
  set(fantom_default_text_layout macos)
elseif(APPLE)
  set(fantom_default_text_layout stub)
else()
  set(fantom_default_text_layout portable)
endif()
set(FANTOM_TEXT_LAYOUT "${fantom_default_text_layout}" CACHE STRING "Text layout: macos, portable or stub")
set_property(CACHE FANTOM_TEXT_LAYOUT PROPERTY STRINGS macos portable stub)
if(NOT FANTOM_TEXT_LAYOUT MATCHES "^(macos|portable|stub)$")
  message(FATAL_ERROR "FANTOM_TEXT_LAYOUT must be macos, portable or stub (got ${FANTOM_TEXT_LAYOUT})")
endif()
if(FANTOM_TEXT_LAYOUT STREQUAL "macos" AND NOT APPLE)
  message(FATAL_ERROR "FANTOM_TEXT_LAYOUT=macos needs an Apple platform")
endif()
message(STATUS "Text layout: ${FANTOM_TEXT_LAYOUT}")
if(FANTOM_TEXT_LAYOUT STREQUAL "macos")
  # Needed by the macOS TextLayoutManager (see below).
  enable_language(OBJCXX)
endif()

include_directories(${REACT_ANDROID_DIR}/hermes-engine/build/prefab-headers)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake/modules/")
include(Deps)

# FANTOM_STATIC_HOST (default ON): one executable without dylibs. Hermes,
# JSI and OpenSSL's libcrypto are linked statically:
#  - Hermes: the static archives that the Hermes build produces as the input
#    of libhermesvm.dylib (libhermesvm_a.a and the libraries it needs, the
#    same list as the link of libhermesvm.dylib, without Hermes' own copy of
#    JSI), so no separate Hermes build is needed.
#  - JSI: ReactCommon/jsi/CMakeLists.txt hardcodes a SHARED library; the same
#    target is defined here as STATIC (see below). It is the only copy of JSI
#    in the executable (Hermes objects resolve their JSI symbols to it).
#  - OpenSSL: only SHA256 in ReactCxxPlatform devsupport. On Apple the static
#    host uses a CommonCrypto shim (src/stubs/crypto, FANTOM_OPENSSL_SHIM)
#    instead of libcrypto.a, which Homebrew has only for the build machine's
#    architecture (needed for the x86_64 / universal host). Elsewhere the
#    shim is a plain C++ SHA-256 (Sha256Portable.cpp): no libcrypto.a is
#    needed (AlmaLinux 8, the Linux build image, has none).
# FANTOM_HERMES_BUILD_DIR: the Hermes build to link (default: the gradle one;
# scripts/build-host.sh passes an x86_64 build for RN_A11Y_HOST_ARCH=x86_64).
option(FANTOM_STATIC_HOST "Link Hermes, JSI and OpenSSL statically" ON)
option(FANTOM_OPENSSL_SHIM "SHA256 through a shim (CommonCrypto on Apple, plain C++ elsewhere) instead of OpenSSL (static host)" ON)
if(UNIX AND NOT APPLE AND NOT FANTOM_STATIC_HOST)
  set(CMAKE_C_LINK_FLAGS "${CMAKE_C_LINK_FLAGS} -latomic")
  set(CMAKE_CXX_LINK_FLAGS "${CMAKE_CXX_LINK_FLAGS} -latomic")
endif()
if(FANTOM_HERMES_BUILD_DIR)
  set(HERMES_BUILD_DIR ${FANTOM_HERMES_BUILD_DIR})
else()
  set(HERMES_BUILD_DIR ${REACT_ANDROID_DIR}/hermes-engine/build/hermes)
endif()
add_library(hermes-engine::hermesvm INTERFACE IMPORTED)
if(FANTOM_STATIC_HOST)
  set(hermes_static_libs)
  foreach(archive
      lib/libhermesvm_a.a
      lib/Parser/libhermesParser.a
      lib/AST/libhermesAST.a
      lib/Support/libhermesSupport.a
      lib/Regex/libhermesRegex.a
      lib/Platform/Unicode/libhermesPlatformUnicode.a
      external/dtoa/libdtoa.a
      external/llvh/lib/Support/libLLVHSupport.a
      external/llvh/lib/Demangle/libLLVHDemangle.a)
    if(NOT EXISTS "${HERMES_BUILD_DIR}/${archive}")
      message(FATAL_ERROR "Hermes static library not found: ${HERMES_BUILD_DIR}/${archive}")
    endif()
    list(APPEND hermes_static_libs "${HERMES_BUILD_DIR}/${archive}")
  endforeach()
  file(GLOB boost_context_lib
    "${HERMES_BUILD_DIR}/external/boost/*/libs/context/libboost_context.a")
  list(APPEND hermes_static_libs ${boost_context_lib})
  if(APPLE)
    list(APPEND hermes_static_libs "-framework CoreFoundation")
  else()
    # Hermes' Unicode functions (PlatformUnicodeICU.cpp: collation,
    # normalization, case mapping, date formatting) use ICU off Apple.
    # FANTOM_STATIC_ICU (default ON): the static archives, with ICU's data
    # (libicudata.a), so the host does not depend on the distribution's ICU
    # version (its symbols carry the version, e.g. ucol_open_74).
    option(FANTOM_STATIC_ICU "Link ICU statically (static host, not Apple)" ON)
    if(FANTOM_STATIC_ICU)
      set(icu_static_libs)
      foreach(icu_lib icui18n icuuc icudata)
        find_library(FANTOM_ICU_${icu_lib}_STATIC NAMES lib${icu_lib}.a)
        if(NOT FANTOM_ICU_${icu_lib}_STATIC)
          message(FATAL_ERROR "lib${icu_lib}.a not found (install the ICU development package, e.g. libicu-dev, or configure with -DFANTOM_STATIC_ICU=OFF)")
        endif()
        list(APPEND icu_static_libs ${FANTOM_ICU_${icu_lib}_STATIC})
      endforeach()
      list(APPEND hermes_static_libs ${icu_static_libs} ${CMAKE_DL_LIBS} pthread)
    else()
      list(APPEND hermes_static_libs icui18n icuuc icudata)
    endif()
    set(FANTOM_HOST_USES_ICU ON)
  endif()
  set_target_properties(hermes-engine::hermesvm PROPERTIES
    INTERFACE_LINK_LIBRARIES "${hermes_static_libs}")
  set(OPENSSL_USE_STATIC_LIBS TRUE)
  # A build directory configured before may have cached the dylibs.
  foreach(openssl_library OPENSSL_CRYPTO_LIBRARY OPENSSL_SSL_LIBRARY)
    if(${openssl_library} MATCHES "\\.dylib$")
      unset(${openssl_library} CACHE)
    endif()
  endforeach()
else()
  find_library(LIB_HERMES hermesvm
    HINTS ${HERMES_BUILD_DIR}/lib
    REQUIRED)
  set_target_properties(hermes-engine::hermesvm PROPERTIES
    INTERFACE_LINK_LIBRARIES ${LIB_HERMES})
endif()
if(FANTOM_STATIC_HOST AND FANTOM_OPENSSL_SHIM)
  if(APPLE)
    set(fantom_sha256_source Sha256Shim.cpp)
  else()
    set(fantom_sha256_source Sha256Portable.cpp)
  endif()
  add_library(fantom_sha256_shim STATIC ${CMAKE_CURRENT_SOURCE_DIR}/src/stubs/crypto/${fantom_sha256_source})
  target_include_directories(fantom_sha256_shim PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src/stubs/crypto)
  add_library(OpenSSL::Crypto ALIAS fantom_sha256_shim)
else()
  find_package(OpenSSL REQUIRED)
endif()

# Boost in NDK is not compatible with desktop build
add_third_party_subdir(boost)

# Third-party downloaded targets
add_react_third_party_ndk_subdir(glog)
add_react_third_party_ndk_subdir(double-conversion)
add_react_third_party_ndk_subdir(fast_float)
add_react_third_party_ndk_subdir(fmt)
add_fantom_third_party_subdir(folly)
add_fantom_third_party_subdir(gflags)
add_fantom_third_party_subdir(nlohmann_json)

add_subdirectory(${FANTOM_CODEGEN_DIR} codegen)

add_library(glog_init INTERFACE)

add_react_common_subdir(callinvoker)
add_react_common_subdir(cxxreact)
add_react_common_subdir(devtoolsruntimesettings)
add_react_common_subdir(hermes/executor)
add_react_common_subdir(hermes/inspector-modern)
add_react_common_subdir(jserrorhandler)
if(FANTOM_STATIC_HOST)
  # Same as ReactCommon/jsi/CMakeLists.txt, but STATIC instead of SHARED.
  include(${REACT_COMMON_DIR}/cmake-utils/react-native-flags.cmake)
  file(GLOB jsi_SRC CONFIGURE_DEPENDS ${REACT_COMMON_DIR}/jsi/jsi/*.cpp)
  add_library(jsi STATIC ${jsi_SRC})
  target_include_directories(jsi PUBLIC ${REACT_COMMON_DIR}/jsi)
  target_link_libraries(jsi folly_runtime glog)
  target_compile_reactnative_options(jsi PRIVATE)
  target_compile_options(jsi PRIVATE -O3 -Wno-unused-lambda-capture)
else()
  add_react_common_subdir(jsi)
endif()
add_react_common_subdir(jsiexecutor)
add_react_common_subdir(jsinspector-modern)
add_react_common_subdir(jsinspector-modern/cdp)
add_react_common_subdir(jsinspector-modern/network)
add_react_common_subdir(jsinspector-modern/tracing)
add_react_common_subdir(jsitooling)
add_react_common_subdir(logger)
add_react_common_subdir(oscompat)
add_react_common_subdir(react/bridging)
add_react_common_subdir(react/cxxstableapi)
add_react_common_subdir(react/debug)
add_react_common_subdir(react/featureflags)
add_react_common_subdir(react/nativemodule/core)
add_react_common_subdir(react/nativemodule/cputime)
add_react_common_subdir(react/nativemodule/defaults)
add_react_common_subdir(react/nativemodule/devtoolsruntimesettings)
add_react_common_subdir(react/nativemodule/dom)
add_react_common_subdir(react/nativemodule/fantomtestspecificmethods)
add_react_common_subdir(react/nativemodule/featureflags)
add_react_common_subdir(react/nativemodule/idlecallbacks)
add_react_common_subdir(react/nativemodule/intersectionobserver)
add_react_common_subdir(react/nativemodule/microtasks)
add_react_common_subdir(react/nativemodule/mutationobserver)
add_react_common_subdir(react/nativemodule/resizeobserver)
add_react_common_subdir(react/nativemodule/viewtransition)
add_react_common_subdir(react/nativemodule/webperformance)
add_react_common_subdir(react/performance/cdpmetrics)
add_react_common_subdir(react/performance/timeline)
add_react_common_subdir(react/renderer/animated)
add_react_common_subdir(react/renderer/animationbackend)
add_react_common_subdir(react/renderer/attributedstring)
add_react_common_subdir(react/renderer/bridging)
add_react_common_subdir(react/renderer/componentregistry)
add_react_common_subdir(react/renderer/componentregistry/native)
add_react_common_subdir(react/renderer/components/image)
add_react_common_subdir(react/renderer/components/legacyviewmanagerinterop)
add_react_common_subdir(react/renderer/components/modal)
add_react_common_subdir(react/renderer/components/root)
add_react_common_subdir(react/renderer/components/scrollview)
add_react_common_subdir(react/renderer/components/text)
add_react_common_subdir(react/renderer/components/textinput)
# The platform/android sources need JNI, RN_SERIALIZABLE_STATE and the Android
# TextLayoutManager API. The tester registers its own AndroidTextInput shadow
# node (src/components/FantomTextInput.h) and only uses the cross-platform
# sources of rrc_textinput (BaseTextInputProps, TextInputEventEmitter).
get_target_property(RRC_TEXTINPUT_SOURCES rrc_textinput SOURCES)
list(FILTER RRC_TEXTINPUT_SOURCES EXCLUDE REGEX "/androidtextinput/[^/]*\\.cpp$")
set_property(TARGET rrc_textinput PROPERTY SOURCES ${RRC_TEXTINPUT_SOURCES})
add_react_common_subdir(react/renderer/components/view)
add_react_common_subdir(react/renderer/consistency)
add_react_common_subdir(react/renderer/core)
add_react_common_subdir(react/renderer/css)
add_react_common_subdir(react/renderer/debug)
add_react_common_subdir(react/renderer/dom)
add_react_common_subdir(react/renderer/graphics)
add_react_common_subdir(react/renderer/imagemanager)
add_react_common_subdir(react/renderer/leakchecker)
add_react_common_subdir(react/renderer/mapbuffer)
add_react_common_subdir(react/renderer/mounting)
add_react_common_subdir(react/renderer/observers/events)
add_react_common_subdir(react/renderer/observers/intersection)
add_react_common_subdir(react/renderer/observers/mutation)
add_react_common_subdir(react/renderer/observers/resize)
add_react_common_subdir(react/renderer/runtimescheduler)
add_react_common_subdir(react/renderer/scheduler)
add_react_common_subdir(react/renderer/telemetry)
add_react_common_subdir(react/renderer/textlayoutmanager)
if(NOT FANTOM_TEXT_LAYOUT STREQUAL "stub")
  # Replace the stub cxx TextLayoutManager (which returns the minimum size for
  # every text) with the CoreText/AppKit or the portable implementation (same
  # header, platform/cxx/.../TextLayoutManager.h).
  get_target_property(TLM_SOURCES react_renderer_textlayoutmanager SOURCES)
  list(FILTER TLM_SOURCES EXCLUDE REGEX "platform/cxx/react/renderer/textlayoutmanager/TextLayoutManager\\.cpp$")
  set_property(TARGET react_renderer_textlayoutmanager PROPERTY SOURCES ${TLM_SOURCES})
endif()
if(FANTOM_TEXT_LAYOUT STREQUAL "portable")
  target_sources(react_renderer_textlayoutmanager
    PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src/platform/portable/TextLayoutManager.cpp)
endif()
if(FANTOM_TEXT_LAYOUT STREQUAL "macos")
  target_sources(react_renderer_textlayoutmanager
    PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src/platform/macos/TextLayoutManager.mm)
  target_compile_options(react_renderer_textlayoutmanager
    PRIVATE $<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc>)
  target_link_libraries(react_renderer_textlayoutmanager
    "-framework AppKit" "-framework CoreText" "-framework Foundation")
endif()
add_react_common_subdir(react/renderer/uimanager)
add_react_common_subdir(react/renderer/viewtransition)
add_react_common_subdir(react/renderer/uimanager/consistency)
add_react_common_subdir(react/runtime)
add_react_common_subdir(react/runtime/hermes)
add_react_common_subdir(react/timing)
add_react_common_subdir(react/utils)
add_react_common_subdir(reactperflogger)
add_react_common_subdir(runtimeexecutor)
add_react_common_subdir(yoga)

# This is a hack to make sure that libraries that depend on jni yoga are linked
add_library(yoga ALIAS yogacore)

add_react_cxx_platform_subdir(react/coremodules)
add_react_cxx_platform_subdir(react/devsupport)
add_react_cxx_platform_subdir(react/http)
add_react_cxx_platform_subdir(react/io)
add_react_cxx_platform_subdir(react/logging)
add_react_cxx_platform_subdir(react/nativemodule)
add_react_cxx_platform_subdir(react/profiling)
add_react_cxx_platform_subdir(react/renderer/scheduler)
add_react_cxx_platform_subdir(react/renderer/uimanager)
add_react_cxx_platform_subdir(react/runtime)
add_react_cxx_platform_subdir(react/threading)
add_react_cxx_platform_subdir(react/utils)

# Native libraries from npm (optional): react-native-screens,
# react-native-safe-area-context, ... They are looked up in the directory in
# the RN_NATIVE_LIBS_DIR environment variable (not FANTOM_*: the Fantom runner
# rejects unknown FANTOM_* variables), or in the node_modules directory next to the React
# Native checkout (the host repo keeps React Native in third_party/react-native).
# For each library found, its codegen output is generated at configure time
# into the build directory (scripts/codegen-lib.sh), and its C++ plus the
# codegen C++ are built as an OBJECT library linked into fantom_tester, which
# gets FANTOM_WITH_<TARGET>=1. The non-Android branches of the libraries' C++
# are used (the Android branches need JNI).
if(DEFINED ENV{RN_NATIVE_LIBS_DIR})
  set(FANTOM_NODE_MODULES_DIR "$ENV{RN_NATIVE_LIBS_DIR}")
else()
  get_filename_component(FANTOM_NODE_MODULES_DIR
    "${REACT_COMMON_DIR}/../../../../../node_modules" ABSOLUTE)
endif()
set(FANTOM_NATIVE_LIBRARIES)

# Roboto, the Android system font, compiled into the executable
# (native/fonts/roboto): gzip byte arrays generated at build time by
# cmake/embed-files.cmake, inflated and registered at startup by
# src/platform/macos/EmbeddedFonts.mm (macos), or inflated and parsed by
# src/platform/portable/PortableFonts.cpp (portable).
if(NOT FANTOM_TEXT_LAYOUT STREQUAL "stub")
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
  if(FANTOM_TEXT_LAYOUT STREQUAL "macos")
    add_library(fantom_embedded_fonts STATIC
      ${CMAKE_CURRENT_SOURCE_DIR}/src/platform/macos/EmbeddedFonts.mm
      ${embedded_font_data})
    target_compile_options(fantom_embedded_fonts PRIVATE -std=c++20 -Wall -Werror)
    target_link_libraries(fantom_embedded_fonts PUBLIC "-framework CoreText" "-framework Foundation" compression)
    target_include_directories(react_renderer_textlayoutmanager
      PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src/platform/macos)
  else()
    # The portable fonts and paragraph layout (STL and the vendored stb
    # headers only), with the font data.
    add_library(fantom_embedded_fonts STATIC
      ${CMAKE_CURRENT_SOURCE_DIR}/src/platform/portable/PortableFonts.cpp
      ${CMAKE_CURRENT_SOURCE_DIR}/src/platform/portable/PortableTextLayout.cpp
      ${CMAKE_CURRENT_SOURCE_DIR}/src/platform/portable/StbImpl.cpp
      ${embedded_font_data})
    target_include_directories(fantom_embedded_fonts
      PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src/platform/portable
      PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/third_party/stb)
    target_compile_definitions(fantom_embedded_fonts PRIVATE FANTOM_WITH_EMBEDDED_FONTS=1)
    target_compile_features(fantom_embedded_fonts PRIVATE cxx_std_20)
    # Third-party code: no warnings.
    if(MSVC)
      set(fantom_no_warnings /w)
    else()
      target_compile_options(fantom_embedded_fonts PRIVATE -Wall -Werror)
      set(fantom_no_warnings -w)
    endif()
    set_source_files_properties(${CMAKE_CURRENT_SOURCE_DIR}/src/platform/portable/StbImpl.cpp
      PROPERTIES COMPILE_OPTIONS "${fantom_no_warnings}")
  endif()
  target_link_libraries(react_renderer_textlayoutmanager fantom_embedded_fonts)
  target_compile_definitions(react_renderer_textlayoutmanager PRIVATE FANTOM_WITH_EMBEDDED_FONTS=1)
endif()

# fantom_add_native_library(<target> <package> <codegen name>
#   SOURCE_GLOBS <globs relative to the package>...
#   INCLUDE_DIRS <dirs relative to the package>...   (before the codegen output)
#   DEFINITIONS <compile definitions>...)
function(fantom_add_native_library target package codegen_name)
  cmake_parse_arguments(ARG "" "" "SOURCE_GLOBS;INCLUDE_DIRS;DEFINITIONS" ${ARGN})
  set(package_dir "${FANTOM_NODE_MODULES_DIR}/${package}")
  if(NOT EXISTS "${package_dir}/package.json")
    message(STATUS "${package}: not found in ${FANTOM_NODE_MODULES_DIR}, skipped")
    return()
  endif()
  message(STATUS "${package}: ${package_dir}")

  # codegen_name NONE: the package has no codegen specs (expo-modules-core).
  set(source_globs)
  set(codegen_include_dirs)
  if(NOT codegen_name STREQUAL "NONE")
    set(codegen_dir "${CMAKE_BINARY_DIR}/codegen-libs/${codegen_name}")
    execute_process(
      COMMAND bash "${CMAKE_CURRENT_SOURCE_DIR}/scripts/codegen-lib.sh"
        "${package_dir}" "${codegen_name}" "${codegen_dir}"
      RESULT_VARIABLE codegen_result)
    if(NOT codegen_result EQUAL 0)
      message(FATAL_ERROR "codegen for ${package} failed")
    endif()
    # Re-run codegen when the package or its specs change.
    file(GLOB_RECURSE specs CONFIGURE_DEPENDS
      "${package_dir}/src/*NativeComponent.ts" "${package_dir}/src/specs/*.ts"
      "${package_dir}/src/fabric/*.ts")
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
      "${package_dir}/package.json" ${specs})
    list(APPEND source_globs "${codegen_dir}/jni/react/renderer/components/${codegen_name}/*.cpp")
    list(APPEND codegen_include_dirs "${codegen_dir}/jni")
  endif()

  foreach(glob ${ARG_SOURCE_GLOBS})
    list(APPEND source_globs "${package_dir}/${glob}")
  endforeach()
  file(GLOB sources CONFIGURE_DEPENDS ${source_globs})
  add_library(${target} OBJECT ${sources})

  set(include_dirs)
  foreach(dir ${ARG_INCLUDE_DIRS})
    list(APPEND include_dirs "${package_dir}/${dir}")
  endforeach()
  target_include_directories(${target} PUBLIC ${include_dirs} ${codegen_include_dirs})
  target_link_libraries(${target}
    folly_runtime
    glog
    jsi
    react_debug
    react_renderer_componentregistry
    react_renderer_core
    react_renderer_debug
    react_renderer_graphics
    react_renderer_imagemanager
    react_renderer_uimanager
    react_utils
    rrc_image
    rrc_root
    rrc_view
    yoga)
  target_compile_reactnative_options(${target} PRIVATE)
  if(ARG_DEFINITIONS)
    target_compile_definitions(${target} PRIVATE ${ARG_DEFINITIONS})
  endif()
  # Third-party code: keep warnings, do not fail on them.
  target_compile_options(${target} PRIVATE -Wno-error)

  set(FANTOM_NATIVE_LIBRARIES ${FANTOM_NATIVE_LIBRARIES} ${target} PARENT_SCOPE)
endfunction()

# The react-native-screens common C++ registers the iOS names of the tabs and
# "gamma" stack components (RNSTabsHostIOS, RNSStackHeaderConfigIOS, ...).
fantom_add_native_library(rnscreens react-native-screens rnscreens
  SOURCE_GLOBS "common/cpp/react/renderer/components/rnscreens/*.cpp"
  INCLUDE_DIRS "common/cpp")
fantom_add_native_library(safeareacontext react-native-safe-area-context safeareacontext
  SOURCE_GLOBS "common/cpp/react/renderer/components/safeareacontext/*.cpp"
  INCLUDE_DIRS "common/cpp")

# ---- rn-a11y: reanimated (begin) --------------------------------------------
# react-native-worklets + react-native-reanimated (Common C++) and the host glue
# in src/reanimated/ (compiled into the `reanimated` library). Both packages
# are needed; fantom_tester then gets FANTOM_WITH_REANIMATED=1.
# "[NAME:value]..." from a package's staticFlags.json defaults (the podspecs
# build the same string with get_static_feature_flags()).
function(fantom_static_feature_flags json_path out_var)
  file(READ "${json_path}" flags_json)
  string(JSON flags_count LENGTH "${flags_json}")
  math(EXPR flags_last "${flags_count} - 1")
  set(flags "")
  foreach(i RANGE ${flags_last})
    string(JSON name MEMBER "${flags_json}" ${i})
    string(JSON value GET "${flags_json}" "${name}")
    if(value)
      string(APPEND flags "[${name}:true]")
    else()
      string(APPEND flags "[${name}:false]")
    endif()
  endforeach()
  set(${out_var} "${flags}" PARENT_SCOPE)
endfunction()

set(FANTOM_WORKLETS_DIR "${FANTOM_NODE_MODULES_DIR}/react-native-worklets")
set(FANTOM_REANIMATED_DIR "${FANTOM_NODE_MODULES_DIR}/react-native-reanimated")
if(NOT EXISTS "${FANTOM_WORKLETS_DIR}/package.json" OR
   NOT EXISTS "${FANTOM_REANIMATED_DIR}/package.json")
  message(STATUS "react-native-reanimated/react-native-worklets: not both found in ${FANTOM_NODE_MODULES_DIR}, skipped")
else()
  file(READ "${FANTOM_WORKLETS_DIR}/package.json" package_json)
  string(JSON FANTOM_WORKLETS_VERSION GET "${package_json}" version)
  file(READ "${FANTOM_REANIMATED_DIR}/package.json" package_json)
  string(JSON FANTOM_REANIMATED_VERSION GET "${package_json}" version)
  fantom_static_feature_flags(
    "${FANTOM_WORKLETS_DIR}/src/featureFlags/staticFlags.json" FANTOM_WORKLETS_FEATURE_FLAGS)
  fantom_static_feature_flags(
    "${FANTOM_REANIMATED_DIR}/src/featureFlags/staticFlags.json" FANTOM_REANIMATED_FEATURE_FLAGS)

  # worklets (codegen `rnworklets` is modules only: no component sources).
  fantom_add_native_library(worklets react-native-worklets rnworklets
    INCLUDE_DIRS "Common/cpp")
  file(GLOB_RECURSE worklets_sources CONFIGURE_DEPENDS
    "${FANTOM_WORKLETS_DIR}/Common/cpp/worklets/*.cpp")
  target_sources(worklets PRIVATE ${worklets_sources})
  # Public: the flags are read in headers (constexpr getFlag).
  target_compile_definitions(worklets PUBLIC
    WORKLETS_VERSION=${FANTOM_WORKLETS_VERSION}
    WORKLETS_FEATURE_FLAGS=${FANTOM_WORKLETS_FEATURE_FLAGS})
  target_compile_options(worklets PRIVATE -Wno-everything)
  target_link_libraries(worklets
    hermes-engine::hermesvm
    jsireact
    react_cxxreact
    react_nativemodule_core
    $<$<PLATFORM_ID:Darwin>:-lobjc>) # objc_autoreleasePoolPush/Pop in RunLoop/AsyncQueueImpl.cpp

  # reanimated. Common/NativeView before the codegen output: its
  # rnreanimated/ComponentDescriptors.h replaces the generated (empty) one.
  fantom_add_native_library(reanimated react-native-reanimated rnreanimated
    SOURCE_GLOBS "Common/NativeView/react/renderer/components/rnreanimated/*.cpp"
    INCLUDE_DIRS "Common/cpp" "Common/NativeView")
  file(GLOB_RECURSE reanimated_sources CONFIGURE_DEPENDS
    "${FANTOM_REANIMATED_DIR}/Common/cpp/reanimated/*.cpp")
  file(GLOB reanimated_host_sources CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/src/reanimated/*.cpp")
  target_sources(reanimated PRIVATE ${reanimated_sources} ${reanimated_host_sources})
  target_compile_definitions(reanimated PUBLIC
    REANIMATED_VERSION=${FANTOM_REANIMATED_VERSION}
    REANIMATED_FEATURE_FLAGS=${FANTOM_REANIMATED_FEATURE_FLAGS})
  target_compile_options(reanimated PRIVATE -Wno-everything)
  target_link_libraries(reanimated
    worklets
    react_featureflags
    react_renderer_animationbackend
    react_renderer_dom
    react_renderer_mounting
    react_renderer_scheduler
    rrc_scrollview)
endif()
# ---- rn-a11y: reanimated (end) ----------------------------------------------
# shared/shadowNodes has the RNGestureHandlerDetector shadow node and a
# ComponentDescriptors.h that must shadow the codegen one (include order).
fantom_add_native_library(rngesturehandler react-native-gesture-handler rngesturehandler_codegen
  SOURCE_GLOBS "shared/shadowNodes/react/renderer/components/rngesturehandler_codegen/*.cpp"
  INCLUDE_DIRS "shared/shadowNodes")
# expo-modules-core: the Fabric view of every Expo module view
# (ExpoViewComponentDescriptor; @expo/ui primitives are
# ViewManagerAdapter_ExpoUI_<View>). No codegen. FANTOM_WITH_EXPO_UI when
# @expo/ui is installed too.
fantom_add_native_library(expomodulescore expo-modules-core NONE
  SOURCE_GLOBS "common/cpp/fabric/*.cpp"
  INCLUDE_DIRS "common/cpp" "common/cpp/fabric")
if(TARGET expomodulescore AND EXISTS "${FANTOM_NODE_MODULES_DIR}/@expo/ui/package.json")
  set(FANTOM_WITH_EXPO_UI ON)
endif()

# ---- Not Apple: third-party code that only builds with libc++ / on Apple ----
# The Mac host does not use any of this. Upstream fixes would make each entry
# unnecessary.
if(NOT APPLE)
  # fantom_force_std_includes(<targets>...): force-include
  # src/platform/compat/StdIncludes.h (standard headers that libc++ includes
  # transitively and libstdc++ does not) into the C++ of <targets>.
  function(fantom_force_std_includes)
    set(header "${CMAKE_CURRENT_SOURCE_DIR}/src/platform/compat/StdIncludes.h")
    foreach(target ${ARGN})
      if(TARGET ${target})
        # One argument (clang's joined -include<file>, MSVC's /FI<file>):
        # CMake de-duplicates repeated option words.
        if(MSVC)
          target_compile_options(${target} PRIVATE "$<$<COMPILE_LANGUAGE:CXX>:/FI${header}>")
        else()
          target_compile_options(${target} PRIVATE "$<$<COMPILE_LANGUAGE:CXX>:-include${header}>")
        endif()
      endif()
    endforeach()
  endfunction()
  fantom_force_std_includes(jsinspector_network react_debug worklets reanimated)

  # fantom_patched_copy(<package dir> <patch> <out dir> <files>...): copies
  # <files> (relative to <package dir>) to <out dir> and applies <patch>
  # (patches/*.patch, paths relative to the package, -p1) to the copy, at
  # configure time. node_modules stays as it is. Re-done when the patch or a
  # file changes.
  function(fantom_patched_copy package_dir patch out_dir)
    file(SHA256 "${patch}" inputs_hash)
    set(inputs "${patch}")
    foreach(file ${ARGN})
      file(SHA256 "${package_dir}/${file}" file_hash)
      string(APPEND inputs_hash " ${file_hash}")
      list(APPEND inputs "${package_dir}/${file}")
    endforeach()
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${inputs})
    set(stamp "${out_dir}/.fantom-patch-stamp")
    if(EXISTS "${stamp}")
      file(READ "${stamp}" stamp_hash)
      if(stamp_hash STREQUAL inputs_hash)
        return()
      endif()
    endif()
    find_program(FANTOM_PATCH_PROGRAM patch REQUIRED)
    file(REMOVE_RECURSE "${out_dir}")
    foreach(file ${ARGN})
      get_filename_component(file_dir "${out_dir}/${file}" DIRECTORY)
      file(COPY "${package_dir}/${file}" DESTINATION "${file_dir}")
    endforeach()
    execute_process(
      COMMAND ${FANTOM_PATCH_PROGRAM} -p1 --forward --batch -i "${patch}"
      WORKING_DIRECTORY "${out_dir}"
      RESULT_VARIABLE patch_result
      OUTPUT_VARIABLE patch_output
      ERROR_VARIABLE patch_output)
    if(NOT patch_result EQUAL 0)
      message(FATAL_ERROR "${patch} does not apply to ${package_dir}:\n${patch_output}")
    endif()
    file(WRITE "${stamp}" "${inputs_hash}")
  endfunction()

  if(TARGET reanimated)
    # PlatformDepMethodsHolder.h declares SynchronouslyUpdateUIPropsFunction
    # only for ANDROID and __APPLE__: the patched copy uses the Apple type for
    # every non-Android platform. Its directory comes first in the include
    # path (the header is included as <reanimated/Tools/...>).
    set(patched_dir "${CMAKE_BINARY_DIR}/patched/react-native-reanimated")
    fantom_patched_copy("${FANTOM_REANIMATED_DIR}"
      "${CMAKE_CURRENT_SOURCE_DIR}/patches/react-native-reanimated.patch" "${patched_dir}"
      Common/cpp/reanimated/Tools/PlatformDepMethodsHolder.h)
    target_include_directories(reanimated BEFORE PUBLIC "${patched_dir}/Common/cpp")
  endif()
  if(TARGET worklets)
    # AsyncQueueImpl.cpp calls the macOS pthread_setname_np(name) on every
    # non-Android platform: the patched copy (compiled instead of the
    # original) uses the glibc form for non-Apple.
    set(patched_dir "${CMAKE_BINARY_DIR}/patched/react-native-worklets")
    set(patched_source Common/cpp/worklets/RunLoop/AsyncQueueImpl.cpp)
    fantom_patched_copy("${FANTOM_WORKLETS_DIR}"
      "${CMAKE_CURRENT_SOURCE_DIR}/patches/react-native-worklets.patch" "${patched_dir}"
      ${patched_source})
    get_target_property(worklets_sources worklets SOURCES)
    list(FIND worklets_sources "${FANTOM_WORKLETS_DIR}/${patched_source}" original_index)
    if(original_index EQUAL -1)
      message(FATAL_ERROR "worklets: ${patched_source} is not a source of the target")
    endif()
    list(REMOVE_AT worklets_sources ${original_index})
    list(APPEND worklets_sources "${patched_dir}/${patched_source}")
    set_property(TARGET worklets PROPERTY SOURCES ${worklets_sources})
  endif()

  # folly/lang/Exception.cpp uses std::unexpected_handler, deprecated in
  # libstdc++ 14 (folly builds with -Werror).
  target_compile_options(folly_runtime PRIVATE -Wno-error=deprecated-declarations)
endif()

file(GLOB SOURCES CONFIGURE_DEPENDS
    ${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/components/*.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/render/*.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/stubs/*.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/platform/oss/*.cpp
)
add_executable(fantom_tester ${SOURCES})
# iOS bundles render RCTSinglelineTextInputView / RCTMultilineTextInputView,
# which Fabric maps to `TextInput`: ReactCommon's iOS TextInput shadow node
# (plain C++, measured with the platform TextLayoutManager). The textinput
# target (rrc_textinput) only builds the Android variant.
set(FANTOM_IOS_TEXTINPUT_DIR ${REACT_COMMON_DIR}/react/renderer/components/textinput/platform/ios)
target_sources(fantom_tester
  PRIVATE
    ${FANTOM_IOS_TEXTINPUT_DIR}/react/renderer/components/iostextinput/TextInputProps.cpp
    ${FANTOM_IOS_TEXTINPUT_DIR}/react/renderer/components/iostextinput/TextInputShadowNode.cpp)
target_include_directories(fantom_tester PRIVATE ${FANTOM_IOS_TEXTINPUT_DIR})
# For NativeFantom.getHostInfo().
target_compile_definitions(fantom_tester PRIVATE "FANTOM_BUILD_TYPE=\"${CMAKE_BUILD_TYPE}\"")
# Off Apple Hermes uses ICU in ICU's default locale (from LANG / LC_*):
# src/platform/icu/IcuDefaultLocale.cpp sets it to en_US before main(), so
# the output does not depend on the machine's locale.
if(FANTOM_HOST_USES_ICU)
  find_path(FANTOM_ICU_INCLUDE_DIR unicode/uloc.h)
  if(NOT FANTOM_ICU_INCLUDE_DIR)
    message(FATAL_ERROR "unicode/uloc.h not found (ICU headers; see FANTOM_STATIC_ICU)")
  endif()
  target_sources(fantom_tester PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src/platform/icu/IcuDefaultLocale.cpp)
  target_include_directories(fantom_tester PRIVATE ${FANTOM_ICU_INCLUDE_DIR})
  target_compile_definitions(fantom_tester PRIVATE "FANTOM_ICU_DEFAULT_LOCALE=\"en_US\"")
endif()

# Sanitizer builds (scripts/build-host.sh RN_A11Y_HOST_SANITIZE=1): with
# AddressSanitizer folly calls its leak annotations, which live in a file the
# folly_runtime target does not compile.
if(FANTOM_SANITIZE AND TARGET folly_runtime)
  target_sources(folly_runtime PRIVATE ${FANTOM_THIRD_PARTY_DIR}/folly/folly/memory/SanitizeLeak.cpp)
endif()
# UBSan's vptr check stays on for our code, but not for two libraries that
# cast shadow nodes to a sibling type on purpose to reach protected ShadowNode
# members (layout-compatible: the derived types add no data, single
# inheritance, only base members are touched):
# - reanimated: ReanimatedCommitHook / ReanimatedMountHook
#   reinterpret_pointer_cast the RootShadowNode to ReanimatedCommitShadowNode (a
#   ShadowNode subclass with only inline trait setters) to set commit traits;
# - rngesturehandler: RNGestureHandlerDetectorShadowNode::unflattenNode
#   static_pointer_casts each child (any view, e.g. RNGestureHandlerButton) to
#   RNGestureHandlerDetectorShadowNode to set traits_.
if(FANTOM_SANITIZE)
  foreach(target reanimated rngesturehandler)
    if(TARGET ${target})
      target_compile_options(${target} PRIVATE -fno-sanitize=vptr)
    endif()
  endforeach()
endif()

target_include_directories(fantom_tester PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)

if(FANTOM_TEXT_LAYOUT STREQUAL "macos")
  target_compile_definitions(fantom_tester PRIVATE FANTOM_WITH_MACOS_TEXT_LAYOUT=1)
elseif(FANTOM_TEXT_LAYOUT STREQUAL "portable")
  target_compile_definitions(fantom_tester PRIVATE FANTOM_WITH_PORTABLE_TEXT_LAYOUT=1)
endif()
if(FANTOM_WITH_EXPO_UI)
  target_compile_definitions(fantom_tester PRIVATE FANTOM_WITH_EXPO_UI=1)
  # The SwiftUI layout engine for @expo/ui Hosts (STL only; src/expoui/layout).
  file(GLOB FANTOM_EXPO_UI_LAYOUT_SOURCES CONFIGURE_DEPENDS
      ${CMAKE_CURRENT_SOURCE_DIR}/src/expoui/layout/*.cpp)
  target_sources(fantom_tester PRIVATE ${FANTOM_EXPO_UI_LAYOUT_SOURCES})
  target_compile_definitions(fantom_tester PRIVATE FANTOM_EXPO_UI_LAYOUT_ENGINE=1)
  # The Compose layout engine (STL only; src/expoui/compose) with its text
  # adapter: the embedded Roboto (fantom_embedded_fonts above) through CoreText
  # (components/FantomComposeText.mm) or the portable layout
  # (platform/portable/FantomComposeText.cpp).
  if(TARGET fantom_embedded_fonts)
    file(GLOB FANTOM_EXPO_UI_COMPOSE_SOURCES CONFIGURE_DEPENDS
        ${CMAKE_CURRENT_SOURCE_DIR}/src/expoui/compose/*.cpp)
    if(FANTOM_TEXT_LAYOUT STREQUAL "macos")
      set(FANTOM_COMPOSE_TEXT_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/src/components/FantomComposeText.mm)
    else()
      set(FANTOM_COMPOSE_TEXT_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/src/platform/portable/FantomComposeText.cpp)
    endif()
    target_sources(fantom_tester
      PRIVATE
        ${FANTOM_EXPO_UI_COMPOSE_SOURCES}
        ${FANTOM_COMPOSE_TEXT_SOURCE})
    target_link_libraries(fantom_tester PRIVATE fantom_embedded_fonts)
    target_compile_definitions(fantom_tester
      PRIVATE FANTOM_EXPO_UI_COMPOSE_ENGINE=1 FANTOM_WITH_EMBEDDED_FONTS=1)
  endif()
endif()

foreach(library ${FANTOM_NATIVE_LIBRARIES})
  string(TOUPPER "${library}" library_upper)
  target_compile_definitions(fantom_tester PRIVATE FANTOM_WITH_${library_upper}=1)
  target_link_libraries(fantom_tester PRIVATE ${library})
endforeach()

target_link_libraries(fantom_tester
  PRIVATE
    # third-party
    boost
    double-conversion
    fmt
    folly_runtime
    gflags
    glog

    # hermes
    hermes-engine::hermesvm

    # codegen
    react_codegen_rncore

    # ReactCommon
    bridgeless
    bridgelesshermes
    devtoolsruntimesettings
    hermes_executor_common
    hermes_inspector_modern
    jserrorhandler
    jsi
    jsinspector
    jsinspector_cdp
    jsinspector_network
    jsinspector_tracing
    jsireact
    jsitooling
    logger
    oscompat
    react_bridging
    react_cxxreact
    react_debug
    react_featureflags
    react_nativemodule_core
    react_nativemodule_cpu
    react_nativemodule_defaults
    react_nativemodule_devtoolsruntimesettings
    react_nativemodule_dom
    react_nativemodule_fantomspecificmethods
    react_nativemodule_featureflags
    react_nativemodule_idlecallbacks
    react_nativemodule_intersectionobserver
    react_nativemodule_microtasks
    react_nativemodule_mutationobserver
    react_nativemodule_resizeobserver
    react_nativemodule_viewtransition
    react_nativemodule_webperformance
    react_performance_cdpmetrics
    react_performance_timeline
    react_renderer_attributedstring
    react_renderer_componentregistry
    react_renderer_consistency
    react_renderer_core
    react_renderer_css
    react_renderer_debug
    react_renderer_dom
    react_renderer_graphics
    react_renderer_imagemanager
    react_renderer_leakchecker
    react_renderer_mapbuffer
    react_renderer_mounting
    react_renderer_observers_events
    react_renderer_observers_intersection
    react_renderer_observers_mutation
    react_renderer_observers_resize
    react_renderer_runtimescheduler
    react_renderer_scheduler
    react_renderer_telemetry
    react_renderer_textlayoutmanager
    react_renderer_uimanager
    react_renderer_uimanager_consistency
    react_utils
    reactperflogger
    rrc_legacyviewmanagerinterop
    rrc_image
    rrc_modal
    rrc_native
    rrc_root
    rrc_scrollview
    rrc_text
    rrc_textinput
    rrc_view
    runtimeexecutor
    yogacore

    # ReactCxxPlatform
    react_cxx_platform_react_coremodules
    react_cxx_platform_react_devsupport
    react_cxx_platform_react_http
    react_cxx_platform_react_io
    react_cxx_platform_react_logging
    react_cxx_platform_react_profiling
    react_renderer_animated
    react_renderer_animationbackend
    react_cxx_platform_react_renderer_scheduler
    react_cxx_platform_react_runtime
    react_cxx_platform_react_threading
    react_cxx_platform_react_utils
)

target_compile_options(fantom_tester
  PRIVATE
    -Wall
    -Werror
    -fexceptions
    -frtti
    -std=c++20)

# Static host off Apple: one executable for common Linux distributions. Only
# glibc (libc, libm) stays dynamic: libstdc++, libgcc and libatomic are linked
# statically (libatomic.a at the end of the link line, after every library
# that may need it), ICU too (FANTOM_STATIC_ICU above).
if(UNIX AND NOT APPLE AND FANTOM_STATIC_HOST)
  target_link_options(fantom_tester PRIVATE -static-libstdc++ -static-libgcc)
  execute_process(
    COMMAND ${CMAKE_CXX_COMPILER} -print-file-name=libatomic.a
    OUTPUT_VARIABLE fantom_libatomic
    OUTPUT_STRIP_TRAILING_WHITESPACE)
  if(NOT IS_ABSOLUTE "${fantom_libatomic}" OR NOT EXISTS "${fantom_libatomic}")
    message(FATAL_ERROR "libatomic.a not found (${CMAKE_CXX_COMPILER} -print-file-name=libatomic.a: ${fantom_libatomic})")
  endif()
  set(CMAKE_CXX_STANDARD_LIBRARIES "${CMAKE_CXX_STANDARD_LIBRARIES} ${fantom_libatomic}")
endif()
