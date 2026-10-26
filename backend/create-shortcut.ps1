# Puts an "Akashwani" icon on your Desktop that starts backend + ngrok and opens the app. Run once:  .\create-shortcut.ps1
$dir = $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut("$desktop\Akashwani.lnk")
$sc.TargetPath = 'powershell.exe'
$sc.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dir\run-all.ps1`""
$sc.WorkingDirectory = $dir
$sc.IconLocation = "$dir\akashwani.ico,0"
$sc.Description = 'Start Akashwani'
$sc.Save()
$sc2 = $ws.CreateShortcut("$desktop\Stop Akashwani.lnk")
$sc2.TargetPath = 'powershell.exe'
$sc2.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dir\stop-all.ps1`""
$sc2.WorkingDirectory = $dir
$sc2.IconLocation = 'shell32.dll,27'
$sc2.Save()
Write-Host "Created on your Desktop: 'Akashwani' (start) and 'Stop Akashwani'."
