[CmdletBinding()]
param(
  [string]$At = "9:00AM",
  [string]$TaskName = "Discord Word of the Day"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $PSCommandPath
$PosterScript = Join-Path $ScriptDir "post-word-of-day.mjs"
$RunnerScript = Join-Path $ScriptDir "run-word-of-day.ps1"
$EnvFile = Join-Path $ScriptDir ".env"

if (-not (Test-Path -LiteralPath $PosterScript)) {
  throw "Could not find $PosterScript"
}

if (-not (Test-Path -LiteralPath $RunnerScript)) {
  throw "Could not find $RunnerScript"
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  throw "Create .env first by copying .env.example, then paste your Discord webhook URL."
}

$PowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
Get-Command node -ErrorAction Stop | Out-Null

try {
  $RunAt = [datetime]::Parse($At)
} catch {
  throw "Could not understand the time '$At'. Try something like 9:00AM or 18:30."
}

$Action = New-ScheduledTaskAction `
  -Execute $PowerShell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RunnerScript`"" `
  -WorkingDirectory $ScriptDir

$Trigger = New-ScheduledTaskTrigger -Daily -At $RunAt
$Principal = New-ScheduledTaskPrincipal `
  -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
  -LogonType Interactive `
  -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -WakeToRun `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Principal $Principal `
  -Settings $Settings `
  -Description "Posts a daily word to Discord using a webhook." `
  -Force | Out-Null

Write-Host "Installed scheduled task '$TaskName' to run daily at $($RunAt.ToShortTimeString())."
Write-Host "The task is allowed to wake the computer and writes logs to: $(Join-Path $ScriptDir "logs")"
Write-Host "You can test safely with: powershell -ExecutionPolicy Bypass -File `"$RunnerScript`" -DryRun"
Write-Host "To post manually, run: node `"$PosterScript`" --force"
