#!/bin/bash
# Builds "build/Pet the Cat.app" as a universal (arm64 + x86_64) app and signs it.
#
#   ./build.sh                                  ad-hoc signature. Fine for an app you build and run yourself:
#                                               a locally built app is not quarantined, so Gatekeeper does not block it.
#   CODESIGN_IDENTITY="<identity>" ./build.sh   Developer ID signature with the hardened runtime and a secure
#                                               timestamp, both of which Apple's notary service requires.
set -euo pipefail
cd "$(dirname "$0")"

IDENTITY="${CODESIGN_IDENTITY:--}"
APP="build/Pet the Cat.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos12.3" PetTheCat.swift -o "build/PetTheCat-$arch"
done
lipo -create build/PetTheCat-arm64 build/PetTheCat-x86_64 -output "$APP/Contents/MacOS/PetTheCat"
cp Info.plist "$APP/Contents/Info.plist"
cp assets/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
plutil -lint "$APP/Contents/Info.plist"

"$APP/Contents/MacOS/PetTheCat" --selftest
# Also run the Intel slice when this Mac can (Apple silicon with Rosetta, or an Intel Mac).
if arch -x86_64 /usr/bin/true 2>/dev/null; then
  arch -x86_64 "$APP/Contents/MacOS/PetTheCat" --selftest > /dev/null && echo "selftest ok (x86_64)"
fi

if [ "$IDENTITY" = "-" ]; then
  codesign --force --sign - "$APP"
else
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$APP"
fi
codesign --verify --strict --verbose=2 "$APP"
lipo -info "$APP/Contents/MacOS/PetTheCat"
echo "Built: $APP"
