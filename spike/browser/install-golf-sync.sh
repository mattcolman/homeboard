#!/bin/bash
# Schedules golf-sync.mjs via a per-user LaunchAgent — runs in the GUI session
# so the headed persistent-profile Chrome can pass Cloudflare. Daily at 07:30.
#
# Usage:  ./install-golf-sync.sh            # install + load
#         ./install-golf-sync.sh uninstall  # unload + remove
#
# Environment the sync reads (in order): launchd environment > repo .env.local.
#   HOMEBOARD_INGEST_KEY  required — shared secret for /api/ingest
#   INGEST_URL            defaults to http://localhost:3000/api/ingest
#   HOMEBOARD_OWNER       defaults to homeboard-local-development
#   GOLF_CHROME / GOLF_CHROME_PROFILE  override browser/profile paths
set -euo pipefail

LABEL="ai.homeboard.golf-sync"
HERE="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HERE/golf-sync.log"
NODE="$(command -v node)"

if [[ "${1:-}" == "uninstall" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL"
  exit 0
fi

if [[ -z "$NODE" ]]; then
  echo "node is not on PATH — install Node.js first." >&2
  exit 1
fi

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$HERE/golf-sync.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$HERE</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
PLIST

plutil -lint "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl print "gui/$(id -u)/$LABEL" | grep -E "state|program" | head -3

cat <<EOF

Installed $LABEL — golf-sync runs daily at 07:30 while this account is
logged in. Output goes to $LOG.

Test it now with:  node "$HERE/golf-sync.mjs"
Remove it with:    $HERE/install-golf-sync.sh uninstall

To push to the deployed app instead of localhost, set INGEST_URL and
HOMEBOARD_OWNER in the repo .env.local, or edit EnvironmentVariables in
$PLIST and re-run this script.
EOF
