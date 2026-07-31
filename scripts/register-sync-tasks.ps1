$ErrorActionPreference = "Stop"

$syncScript = Join-Path $PSScriptRoot "sync-local.ps1"
$powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$argument = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$syncScript`""
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $argument
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew

$logonTrigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask `
  -TaskName "ContextualMemory-AtLogon" `
  -Description "Update the read-only personal memory index at sign-in." `
  -Action $action `
  -Trigger $logonTrigger `
  -Settings $settings `
  -Force | Out-Null

$repeatTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 30)
Register-ScheduledTask `
  -TaskName "ContextualMemory-Every30Minutes" `
  -Description "Update the read-only personal memory index every 30 minutes." `
  -Action $action `
  -Trigger $repeatTrigger `
  -Settings $settings `
  -Force | Out-Null

Write-Output "Registered ContextualMemory-AtLogon and ContextualMemory-Every30Minutes"
