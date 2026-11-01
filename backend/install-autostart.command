#!/bin/bash
# Akashwani — start automatically when you log in to the Mac (LaunchAgent). Run once. Remove: launchctl unload ~/Library/LaunchAgents/com.akashwani.plist && rm that file
DIR="$(cd "$(dirname "$0")" && pwd)"
P=~/Library/LaunchAgents/com.akashwani.plist
cat > "$P" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.akashwani</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/start.command</string></array>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
</dict></plist>
PLIST
launchctl unload "$P" 2>/dev/null; launchctl load "$P"
echo "Installed: Akashwani starts at every login."
