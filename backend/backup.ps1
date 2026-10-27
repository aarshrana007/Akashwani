# Copies the database, uploaded files and recordings to a dated folder. Run by hand or schedule it:  .\backup.ps1 -Install
param([switch]$Install, [string]$To = "$HOME\OneDrive\AkashwaniBackups")
if ($Install) {
  $a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\backup.ps1`" -To `"$To`""
  $t = New-ScheduledTaskTrigger -Daily -At 2am
  Register-ScheduledTask -TaskName 'Akashwani backup' -Action $a -Trigger $t -Force | Out-Null; Write-Host "Nightly backup at 2am → $To"; exit
}
$dest = Join-Path $To (Get-Date -Format 'yyyy-MM-dd')
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item "$PSScriptRoot\data.db*" $dest -Force -ErrorAction SilentlyContinue
foreach ($d in 'files', 'recordings') { if (Test-Path "$PSScriptRoot\$d") { robocopy "$PSScriptRoot\$d" "$dest\$d" /E /NFL /NDL /NJH /NJS | Out-Null } }
Get-ChildItem $To -Directory | Sort-Object Name -Descending | Select-Object -Skip 14 | Remove-Item -Recurse -Force  # keep 14 days
Write-Host "Backed up to $dest"
