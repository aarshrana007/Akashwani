# Stops the background backend and ngrok started by run-all.ps1 / the desktop icon.
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like '*server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host "Akashwani stopped."
