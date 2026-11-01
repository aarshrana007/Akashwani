#!/bin/bash
# Akashwani — stop backend + ngrok.
pkill -f "node server.js" 2>/dev/null; pkill -x ngrok 2>/dev/null
echo "Akashwani stopped."
