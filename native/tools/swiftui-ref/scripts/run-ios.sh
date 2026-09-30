#!/bin/bash
# Lays out input trees with real SwiftUI on the iOS simulator.
#
#   scripts/run-ios.sh <out.json> <tree.json>...
#
# Builds a minimal simulator app from Sources/swiftui-ref (swiftc, no Xcode project), installs it
# on a dedicated simulator ("swiftui-ref", created on first use from $SWIFTUI_REF_DEVICE_TYPE,
# default "iPhone 17 Pro", and the newest iOS runtime), launches it with the inputs and waits for
# <out.json>. The output maps each input path to the swiftui-ref output format, plus "_device".
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
out="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
shift
inputs=()
for f in "$@"; do inputs+=("$(cd "$(dirname "$f")" && pwd)/$(basename "$f")"); done

device_name=swiftui-ref
device_type="${SWIFTUI_REF_DEVICE_TYPE:-iPhone 17 Pro}"
bundle_id=dev.expo.swiftui-ref
build="$here/.build/ios"
app="$build/SwiftUIRef.app"

udid="$(xcrun simctl list devices -j | /usr/bin/python3 -c "
import json,sys
for rt, devs in json.load(sys.stdin)['devices'].items():
  for d in devs:
    if d['name'] == '$device_name' and d.get('isAvailable', True): print(d['udid']); sys.exit()
")"
if [ -z "$udid" ]; then
  runtime="$(xcrun simctl list runtimes -j | /usr/bin/python3 -c "
import json,sys
rts=[r for r in json.load(sys.stdin)['runtimes'] if r['platform']=='iOS' and r['isAvailable']]
print(sorted(rts, key=lambda r: [int(x) for x in r['version'].split('.')])[-1]['identifier'])")"
  udid="$(xcrun simctl create "$device_name" "$device_type" "$runtime")"
fi
state="$(xcrun simctl list devices -j | /usr/bin/python3 -c "
import json,sys
for rt, devs in json.load(sys.stdin)['devices'].items():
  for d in devs:
    if d['udid'] == '$udid': print(d['state'])")"
[ "$state" = "Booted" ] || xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" -b >/dev/null

sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
mkdir -p "$app"
xcrun --sdk iphonesimulator swiftc -O -target arm64-apple-ios17.0-simulator -sdk "$sdk" \
  -o "$app/SwiftUIRef" "$here"/Sources/swiftui-ref/*.swift
cat > "$app/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>$bundle_id</string>
  <key>CFBundleExecutable</key><string>SwiftUIRef</string>
  <key>CFBundleName</key><string>SwiftUIRef</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>MinimumOSVersion</key><string>17.0</string>
  <key>UIDeviceFamily</key><array><integer>1</integer></array>
  <key>UILaunchScreen</key><dict/>
</dict></plist>
PLIST
codesign --force --sign - "$app" >/dev/null 2>&1
xcrun simctl install "$udid" "$app"
rm -f "$out"
xcrun simctl launch --terminate-running-process "$udid" "$bundle_id" --out "$out" "${inputs[@]}" >/dev/null
for _ in $(seq 1 600); do
  [ -s "$out" ] && break
  sleep 0.1
done
[ -s "$out" ] || { echo "run-ios.sh: no output after 60 s" >&2; exit 1; }
