# Copyright (c) Meta Platforms, Inc. and affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.

cmake_minimum_required(VERSION 3.13)
set(CMAKE_VERBOSE_MAKEFILE on)
if(UNIX AND NOT APPLE)
  set(CMAKE_POSITION_INDEPENDENT_CODE ON)
  set(CMAKE_C_LINK_FLAGS "${CMAKE_C_LINK_FLAGS} -latomic")
  set(CMAKE_CXX_LINK_FLAGS "${CMAKE_CXX_LINK_FLAGS} -latomic")
endif()

project(fantom_tester)

option(FANTOM_MACOS_TEXT_LAYOUT "Measure text with CoreText/AppKit on macOS" ON)
if(APPLE AND FANTOM_MACOS_TEXT_LAYOUT)
  # Needed by the macOS TextLayoutManager (see below).
  enable_language(OBJCXX)
endif()

include_directories(${REACT_ANDROID_DIR}/hermes-engine/build/prefab-headers)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake/modules/")
include(Deps)

find_library(LIB_HERMES hermesvm
  HINTS ${REACT_ANDROID_DIR}/hermes-engine/build/hermes/lib
  REQUIRED)
add_library(hermes-engine::hermesvm INTERFACE IMPORTED)
set_target_properties(hermes-engine::hermesvm PROPERTIES
  INTERFACE_LINK_LIBRARIES ${LIB_HERMES})
find_package(OpenSSL REQUIRED)

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
add_react_common_subdir(jsi)
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
if(APPLE AND FANTOM_MACOS_TEXT_LAYOUT)
  # On macOS, replace the stub cxx TextLayoutManager (which returns the minimum
  # size for every text) with a CoreText/AppKit implementation.
  get_target_property(TLM_SOURCES react_renderer_textlayoutmanager SOURCES)
  list(FILTER TLM_SOURCES EXCLUDE REGEX "platform/cxx/react/renderer/textlayoutmanager/TextLayoutManager\\.cpp$")
  set_property(TARGET react_renderer_textlayoutmanager PROPERTY SOURCES ${TLM_SOURCES})
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

  set(source_globs "${codegen_dir}/jni/react/renderer/components/${codegen_name}/*.cpp")
  foreach(glob ${ARG_SOURCE_GLOBS})
    list(APPEND source_globs "${package_dir}/${glob}")
  endforeach()
  file(GLOB sources CONFIGURE_DEPENDS ${source_globs})
  add_library(${target} OBJECT ${sources})

  set(include_dirs)
  foreach(dir ${ARG_INCLUDE_DIRS})
    list(APPEND include_dirs "${package_dir}/${dir}")
  endforeach()
  target_include_directories(${target} PUBLIC ${include_dirs} "${codegen_dir}/jni")
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
    "-lobjc") # objc_autoreleasePoolPush/Pop in RunLoop/AsyncQueueImpl.cpp

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

file(GLOB SOURCES CONFIGURE_DEPENDS
    ${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/components/*.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/render/*.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/stubs/*.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/platform/oss/*.cpp
)
add_executable(fantom_tester ${SOURCES})

target_include_directories(fantom_tester PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)

if(APPLE AND FANTOM_MACOS_TEXT_LAYOUT)
  target_compile_definitions(fantom_tester PRIVATE FANTOM_WITH_MACOS_TEXT_LAYOUT=1)
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
