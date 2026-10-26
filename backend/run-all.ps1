# Starts backend + ngrok in the background and opens the login page. Used by the auto-start task; you can also run it by hand.
Set-Location $PSScriptRoot
$envFile = Get-Content .env -ErrorAction SilentlyContinue
$domain = ($envFile | Where-Object { $_ -match '^NGROK_DOMAIN=(.+)$' } | ForEach-Object { $Matches[1].Trim() })
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like '*server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if (-not (Test-Path node_modules)) { npm install | Out-Null }
Start-Process node -ArgumentList 'server.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput "$PSScriptRoot\backend.log" -RedirectStandardError "$PSScriptRoot\backend.err.log"
$ngrokArgs = if ($domain) { "http --url=$domain 4000" } else { "http 4000" }
Start-Process ngrok -ArgumentList $ngrokArgs -WindowStyle Hidden
Start-Sleep -Seconds 4
Start-Process "http://localhost:4000"
