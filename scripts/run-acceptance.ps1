[CmdletBinding()]
param(
    [ValidateSet('Manual', 'AfterChange')]
    [string]$Trigger = 'Manual',
    [int]$TimeoutSeconds = 480
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot
$StartedAt = Get-Date
$RunId = $StartedAt.ToString('yyyyMMdd-HHmmss')
$Artifacts = Join-Path $ProjectRoot ("test-results\runs\" + $RunId)
$LogPath = Join-Path $Artifacts 'acceptance-run.log'
$StdoutPath = Join-Path $Artifacts 'test-stdout.log'
$StderrPath = Join-Path $Artifacts 'test-stderr.log'
$TestScript = Join-Path $ProjectRoot 'scripts\run-local-tests.ps1'
$NotifyScript = Join-Path $ProjectRoot 'scripts\discord-acceptance.mjs'
$Node22 = Join-Path $env:LOCALAPPDATA 'Programs\nodejs-22-portable\node-v22.23.4-win-x64\node.exe'
$Node = if (Test-Path -LiteralPath $Node22) { $Node22 } else { (Get-Command node -ErrorAction Stop).Source }
$DependencyLink = Join-Path $ProjectRoot 'node_modules'
$BorrowedDependencies = $false
$DependencyDoc = Join-Path $ProjectRoot 'LOCAL-DEPENDENCIES.md'
if (-not (Test-Path -LiteralPath $DependencyDoc)) { throw 'LOCAL-DEPENDENCIES.md is missing; cannot locate approved local test dependencies.' }
$DependencyText = Get-Content -LiteralPath $DependencyDoc -Raw
$PlaywrightMatch = [regex]::Match($DependencyText, '(?m)^PLAYWRIGHT_PACKAGE=(.+)$')
$VersionMatch = [regex]::Match($DependencyText, '(?m)^PLAYWRIGHT_VERSION=(.+)$')
if (-not $PlaywrightMatch.Success -or -not $VersionMatch.Success) { throw 'LOCAL-DEPENDENCIES.md must list the Playwright package directory and version.' }
$PlaywrightPathValue = [Environment]::ExpandEnvironmentVariables($PlaywrightMatch.Groups[1].Value.Trim())
$PlaywrightDirectory = if ([IO.Path]::IsPathRooted($PlaywrightPathValue)) { [IO.Path]::GetFullPath($PlaywrightPathValue) } else { [IO.Path]::GetFullPath((Join-Path $ProjectRoot $PlaywrightPathValue)) }
$PlaywrightPackageFile = Join-Path $PlaywrightDirectory 'package.json'
if (Test-Path -LiteralPath $PlaywrightPackageFile) {
    $InstalledPlaywright = Get-Content -LiteralPath $PlaywrightPackageFile -Raw | ConvertFrom-Json
    if ([string]$InstalledPlaywright.version -ne $VersionMatch.Groups[1].Value.Trim()) {
        throw "Playwright version mismatch with LOCAL-DEPENDENCIES.md: expected $($VersionMatch.Groups[1].Value.Trim()), found $($InstalledPlaywright.version)."
    }
}
$UserProjectDependencies = Split-Path -Parent $PlaywrightDirectory
if (-not (Test-Path -LiteralPath $DependencyLink) -and (Test-Path -LiteralPath $PlaywrightPackageFile)) {
    New-Item -ItemType Junction -Path $DependencyLink -Target $UserProjectDependencies | Out-Null
    $BorrowedDependencies = $true
}
New-Item -ItemType Directory -Path $Artifacts -Force | Out-Null
$env:GARDEN_ACCEPTANCE_ARTIFACT_DIR = $Artifacts
$env:GARDEN_PROJECT_ROOT = $ProjectRoot
$TestProcess = $null
$TestExitCode = 1
$TimedOut = $false
try {
    Write-Host "dianGarden acceptance ($Trigger)"
    Write-Host "Artifacts: $Artifacts"
    Write-Host "Timeout: $TimeoutSeconds seconds"
    $TestProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $TestScript
    ) -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath
    if (-not $TestProcess.WaitForExit($TimeoutSeconds * 1000)) {
        $TimedOut = $true
        Write-Warning "Acceptance exceeded $TimeoutSeconds seconds; terminating the test process tree."
        & taskkill.exe /PID $TestProcess.Id /T /F | Out-Null
        $TestProcess.WaitForExit()
        $TestExitCode = 124
    } else {
        $TestProcess.Refresh()
        $TestExitCode = $TestProcess.ExitCode
        if ($null -eq $TestExitCode) {
            $ObservedOutput = if (Test-Path -LiteralPath $StdoutPath) { Get-Content -LiteralPath $StdoutPath -Raw } else { '' }
            if ($ObservedOutput -match 'PASS: all selected checks passed\.') { $TestExitCode = 0 } else { $TestExitCode = 1 }
        }
    }
} catch {
    $TestExitCode = 1
    Add-Content -LiteralPath $StderrPath -Value $_.Exception.Message -ErrorAction SilentlyContinue
} finally {
    Remove-Item Env:\GARDEN_ACCEPTANCE_ARTIFACT_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:\GARDEN_PROJECT_ROOT -ErrorAction SilentlyContinue
    if ($TimedOut) {
        $InterruptedWorkspace = Join-Path $ProjectRoot '.local-test-workspace'
        $InterruptedResults = Join-Path $InterruptedWorkspace 'test-results'
        if (Test-Path -LiteralPath $InterruptedResults) {
            Copy-Item -LiteralPath $InterruptedResults -Destination (Join-Path $Artifacts 'test-results') -Recurse -Force -ErrorAction SilentlyContinue
        }
        $InterruptedLog = Join-Path $InterruptedWorkspace 'browser-test.log'
        if (Test-Path -LiteralPath $InterruptedLog) {
            Copy-Item -LiteralPath $InterruptedLog -Destination (Join-Path $Artifacts 'browser-test.log') -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $InterruptedWorkspace) {
            Remove-Item -LiteralPath $InterruptedWorkspace -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    if ($BorrowedDependencies -and (Test-Path -LiteralPath $DependencyLink)) {
        & cmd.exe /c rmdir $DependencyLink | Out-Null
    }
}
$Duration = [math]::Round(((Get-Date) - $StartedAt).TotalSeconds, 1)
$Stdout = if (Test-Path -LiteralPath $StdoutPath) { Get-Content -LiteralPath $StdoutPath -Raw } else { '' }
$Stderr = if (Test-Path -LiteralPath $StderrPath) { Get-Content -LiteralPath $StderrPath -Raw } else { '' }
@(
    "Trigger: $Trigger"
    "Started: $($StartedAt.ToString('yyyy-MM-dd HH:mm:ss'))"
    "DurationSeconds: $Duration"
    "TimedOut: $TimedOut"
    "TestExitCode: $TestExitCode"
    '--- STDOUT ---'
    $Stdout
    '--- STDERR ---'
    $Stderr
) | Set-Content -LiteralPath $LogPath -Encoding utf8
if ($TimedOut) {
    $Summary = "Acceptance timed out after $TimeoutSeconds seconds; test process tree was terminated."
} elseif ($TestExitCode -eq 0) {
    $Summary = 'All selected local API, syntax, and browser smoke checks passed.'
} else {
    $FailureLines = @($Stdout -split "\r?\n" | Where-Object { $_ -match '^\[FAIL\]|^\[ERROR\]|Error:|Exception:|timed out|Timeout|failed \(' } | Select-Object -Last 8)
    if ($FailureLines.Count -gt 0) {
        $Summary = ($FailureLines -join ' | ').Trim()
    } else {
        $LastStage = @($Stdout -split "\r?\n" | Where-Object { $_ -match '^=== .+ ===$' } | Select-Object -Last 1)
        if ($LastStage.Count -gt 0) { $Summary = 'Acceptance stopped during stage: ' + ($LastStage[0] -replace '^=== | ===$', '') + '. No detailed error was captured; review test-stdout.log and test-stderr.log.' }
        else { $Summary = 'Acceptance did not complete. Review test-stdout.log and test-stderr.log.' }
    }
}
$Stdout -split "\r?\n" | Select-Object -Last 35 | ForEach-Object { Write-Host $_ }
if ($Stderr) { $Stderr -split "\r?\n" | Select-Object -Last 10 | ForEach-Object { Write-Host $_ } }
$Result = 'FAIL'
if ($TestExitCode -eq 0 -and -not $TimedOut) { $Result = 'PASS' }
Write-Host ('Acceptance result: ' + $Result)
$NodeArgs = @($NotifyScript, '--result', $Result, '--artifacts', $Artifacts, '--summary', $Summary, '--duration', ($Duration.ToString() + 's'))
$PreviousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$NotifyOutput = & $Node @NodeArgs 2>&1
$NotifyExitCode = $LASTEXITCODE
$ErrorActionPreference = $PreviousErrorActionPreference
$NotifyOutput | ForEach-Object { Write-Host $_ }
if ($NotifyExitCode -ne 0) {
    Write-Warning 'Discord notification is pending locally. It will be retried by the next acceptance run.'
}
Write-Host "Local artifacts: $Artifacts"
if ($TestExitCode -ne 0 -or $TimedOut) { exit 1 }
if ($NotifyExitCode -ne 0) { exit 2 }
exit 0
