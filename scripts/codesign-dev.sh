#!/bin/bash
# Re-sign the dev Electron binary with microphone entitlement and custom app name.
# macOS requires the entitlement for the mic permission dialog to appear.
# Runs automatically after npm install via the postinstall script.

if [ "$(uname)" != "Darwin" ]; then
  echo "[codesign] Skipping — not macOS"
  exit 0
fi

ELECTRON_APP="node_modules/electron/dist/Electron.app"
ENTITLEMENTS="scripts/entitlements.dev.plist"
PLIST="$ELECTRON_APP/Contents/Info.plist"

if [ ! -d "$ELECTRON_APP" ]; then
  echo "[codesign] Electron.app not found, skipping"
  exit 0
fi

if [ ! -f "$ENTITLEMENTS" ]; then
  echo "[codesign] Entitlements file not found, skipping"
  exit 0
fi

# Patch Info.plist so macOS shows "Copilot Intent" in Privacy & Security
echo "[codesign] Patching Info.plist..."
/usr/libexec/PlistBuddy -c "Set :CFBundleName 'Copilot Intent'" "$PLIST" 2>/dev/null
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName 'Copilot Intent'" "$PLIST" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string 'Copilot Intent'" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier 'com.copilot.intent'" "$PLIST" 2>/dev/null

echo "[codesign] Signing Electron.app with microphone entitlement..."
codesign --force --deep --sign - --entitlements "$ENTITLEMENTS" "$ELECTRON_APP" 2>&1
echo "[codesign] Done"
