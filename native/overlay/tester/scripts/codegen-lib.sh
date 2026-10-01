#!/usr/bin/env bash
# Copyright (c) Meta Platforms, Inc. and affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.
#
# Runs React Native codegen for a native library (for example
# react-native-screens) and writes the C++ output to <out-dir>:
#
#   <out-dir>/jni/react/renderer/components/<name>/{Props,EventEmitters,ShadowNodes,States,ComponentDescriptors}.{h,cpp}
#
# Usage: codegen-lib.sh <package-dir> <name> <out-dir>
#
# <name> is the library's codegenConfig.name. The spec directory and Java
# package are read from the library's package.json (codegenConfig). The
# Android generator is used (its output compiles on any host; serialization
# code is behind RN_SERIALIZABLE_STATE). Files in <out-dir> are only rewritten
# when their content changes, so an unchanged library does not cause rebuilds.

set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <package-dir> <name> <out-dir>" >&2
  exit 2
fi

PACKAGE_DIR="$(cd "$1" && pwd)"
NAME="$2"
OUT_DIR="$3"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The React Native checkout: REACT_NATIVE_ROOT, or (when this script is in
# private/react-native-fantom/tester/scripts) four directories up.
RN_ROOT="${REACT_NATIVE_ROOT:-$(cd "$SCRIPT_DIR/../../../.." && pwd)}"
COMBINE_CLI="$RN_ROOT/packages/react-native-codegen/lib/cli/combine/combine-js-to-schema-cli.js"
GENERATE_CLI="$RN_ROOT/packages/react-native/scripts/generate-specs-cli.js"

[[ -f "$COMBINE_CLI" ]] || {
  echo "codegen-lib.sh: $COMBINE_CLI not found (build react-native-codegen first)" >&2
  exit 1
}

read -r JS_SRCS_DIR JAVA_PACKAGE < <(node -e '
  const pkg = require(process.argv[1]);
  const config = pkg.codegenConfig || {};
  if (config.name !== process.argv[2]) {
    console.error(`codegenConfig.name is ${config.name}, expected ${process.argv[2]}`);
    process.exit(1);
  }
  const javaPackage = (config.android && config.android.javaPackageName) || "com.facebook.fbreact.specs";
  console.log(config.jsSrcsDir, javaPackage);
' "$PACKAGE_DIR/package.json" "$NAME")

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

node "$COMBINE_CLI" "$TMP_DIR/schema.json" "$PACKAGE_DIR/$JS_SRCS_DIR"
node "$GENERATE_CLI" -p android -s "$TMP_DIR/schema.json" -o "$TMP_DIR/out" \
  -n "$NAME" -j "$JAVA_PACKAGE" -t all >/dev/null

mkdir -p "$OUT_DIR/jni"
if command -v rsync >/dev/null; then
  rsync -rc --delete "$TMP_DIR/out/jni/" "$OUT_DIR/jni/"
else
  # No rsync (Git for Windows): the same copy with cmp.
  (cd "$OUT_DIR/jni" && find . -type f) | while read -r file; do
    [[ -f "$TMP_DIR/out/jni/$file" ]] || rm -f "$OUT_DIR/jni/$file"
  done
  (cd "$TMP_DIR/out/jni" && find . -type f) | while read -r file; do
    if ! cmp -s "$TMP_DIR/out/jni/$file" "$OUT_DIR/jni/$file"; then
      mkdir -p "$(dirname "$OUT_DIR/jni/$file")"
      cp "$TMP_DIR/out/jni/$file" "$OUT_DIR/jni/$file"
    fi
  done
fi
