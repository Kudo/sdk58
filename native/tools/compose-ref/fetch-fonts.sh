#!/bin/sh
# Downloads Roboto 2.138 (Apache 2.0), the Android system font, into fonts/.
# compose-ref uses it when it is there; otherwise Text uses the macOS default
# font and text sizes do not match Android.
set -eu
cd "$(dirname "$0")"
url=https://github.com/googlefonts/roboto-2/releases/download/v2.138/roboto-unhinted.zip
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/roboto.zip" "$url"
mkdir -p fonts
unzip -q -o -j "$tmp/roboto.zip" 'Roboto-*.ttf' LICENSE -d fonts
ls fonts
