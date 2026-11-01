#!/bin/bash
# Akashwani — start backend + ngrok in the background and open the app. Double-click in Finder.
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node first: brew install node"; read -p "Press Enter"; exit 1; }
[ -f .env ] || { cp .env.example .env; open -e .env; echo "Fill in .env (LiveKit URL/key/secret) then run again"; read -p "Press Enter"; exit 1; }
[ -d node_modules ] || npm install
./stop.command >/dev/null 2>&1
nohup node server.js > backend.log 2> backend.err.log &
DOMAIN=$(grep -E '^NGROK_DOMAIN=' .env | cut -d= -f2 | tr -d ' \r')
if command -v ngrok >/dev/null; then
  if [ -n "$DOMAIN" ]; then nohup ngrok http --url="$DOMAIN" 4000 > ngrok.log 2>&1 & else nohup ngrok http 4000 > ngrok.log 2>&1 & fi
else echo "ngrok not installed (brew install ngrok) — app is local-only on http://localhost:4000"; fi
sleep 3
open http://localhost:4000
[ -n "$DOMAIN" ] && echo "Public link: https://$DOMAIN" || echo "Public link: see http://localhost:4040 (ngrok dashboard)"
