# One-shot local start (Windows PowerShell). Run from the backend folder:  .\start.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# LAN IP of this laptop — LiveKit advertises it so phones on the same Wi-Fi can send media directly.
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Sort-Object InterfaceMetric | Select-Object -First 1).IPAddress
$env:LAN_IP = $ip
Write-Host "LAN IP: $ip"

New-Item -ItemType Directory -Force recordings | Out-Null
docker compose up -d
npm install

Write-Host ""
Write-Host "Backend + web app:  http://localhost:4000"
Write-Host "For your iPhone run in another window:  ngrok http 4000   and open the https URL it prints."
npm start
