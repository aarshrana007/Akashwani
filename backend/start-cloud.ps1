# Calls via LiveKit Cloud (no Docker needed). Edit .env first.
Set-Location $PSScriptRoot
npm install
if (Select-String -Path .env -Pattern 'PASTE' -Quiet) { Write-Host "Edit .env and paste your LiveKit Cloud URL/key/secret first." -ForegroundColor Yellow; notepad .env; exit }
Write-Host "Starting backend. In another window run:  ngrok http 4000"
npm start
