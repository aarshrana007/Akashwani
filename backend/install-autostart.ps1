# Registers Akashwani to start automatically when you log in to Windows (backend + ngrok), then opens the login page.
# Run once from the backend folder:  .\install-autostart.ps1      Remove with:  .\install-autostart.ps1 -Remove
param([switch]$Remove)
$name = 'Akashwani'
if ($Remove) { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue; Write-Host "Removed."; exit }
$dir = $PSScriptRoot
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dir\run-all.ps1`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0 -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Installed. Akashwani will start at every login. Starting it now..."
Start-ScheduledTask -TaskName $name
