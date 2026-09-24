#!/bin/bash
# Build + bundle + run the WKWebView golf.com.au spike.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HERE/WebViewSpike.app"
mkdir -p "$APP/Contents/MacOS"
swiftc -O "$HERE/main.swift" -o "$APP/Contents/MacOS/WebViewSpike" -framework WebKit
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>ai.homeboard.webview-spike</string>
  <key>CFBundleName</key><string>WebViewSpike</string>
  <key>CFBundleExecutable</key><string>WebViewSpike</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
</dict></plist>
PLIST
"$APP/Contents/MacOS/WebViewSpike"
