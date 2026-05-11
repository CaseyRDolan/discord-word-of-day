[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $PSCommandPath
$PosterScript = Join-Path $ScriptDir "post-word-of-day.mjs"
$LogDir = Join-Path $ScriptDir "logs"
$LogFile = Join-Path $LogDir ("word-of-day-{0}.log" -f (Get-Date -Format "yyyy-MM"))

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-RunLog {
  param([string]$Message)
  Add-Content -LiteralPath $LogFile -Value $Message
}

function Join-ProcessArguments {
  param([string[]]$Arguments)

  return ($Arguments | ForEach-Object {
    if ($_ -match '[\s"]') {
      '"' + ($_ -replace '"', '\"') + '"'
    } else {
      $_
    }
  }) -join " "
}

Write-RunLog ""
Write-RunLog "[$(Get-Date -Format o)] Starting Word of the Day run."

try {
  if (-not (Test-Path -LiteralPath $PosterScript)) {
    throw "Could not find $PosterScript"
  }

  $Node = (Get-Command node -ErrorAction Stop).Source
  $Arguments = [System.Collections.Generic.List[string]]::new()
  $Arguments.Add($PosterScript)

  if ($DryRun) {
    $Arguments.Add("--dry-run")
  }

  if ($Force) {
    $Arguments.Add("--force")
  }

  $ProcessInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $ProcessInfo.FileName = $Node
  $ProcessInfo.WorkingDirectory = $ScriptDir
  $ProcessInfo.RedirectStandardOutput = $true
  $ProcessInfo.RedirectStandardError = $true
  $ProcessInfo.UseShellExecute = $false
  $ProcessInfo.Arguments = Join-ProcessArguments $Arguments

  $Process = [System.Diagnostics.Process]::Start($ProcessInfo)
  $StdOut = $Process.StandardOutput.ReadToEnd()
  $StdErr = $Process.StandardError.ReadToEnd()
  $Process.WaitForExit()

  if ($StdOut.Trim()) {
    Write-RunLog $StdOut.TrimEnd()
  }

  if ($StdErr.Trim()) {
    Write-RunLog $StdErr.TrimEnd()
  }

  Write-RunLog "[$(Get-Date -Format o)] Finished with exit code $($Process.ExitCode)."
  exit $Process.ExitCode
} catch {
  Write-RunLog "[$(Get-Date -Format o)] Failed: $($_.Exception.Message)"
  throw
}
