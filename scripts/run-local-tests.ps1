[CmdletBinding()]
param([switch]$SkipBrowser)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$OriginalLocation = Get-Location
$Failures = [System.Collections.Generic.List[string]]::new()
$Workspace = Join-Path $ProjectRoot '.local-test-workspace'
$ServerProcess = $null

# Prefer the approved side-by-side Node.js 22 runtime when available. This avoids
# the reproducible native crash seen with Node.js 24 on this Windows machine,
# without changing the user's global PATH or replacing their installed Node.js.
$Node22Portable = Join-Path $env:LOCALAPPDATA 'Programs\nodejs-22-portable\node-v22.23.4-win-x64'
if (Test-Path -LiteralPath (Join-Path $Node22Portable 'node.exe')) {
    $env:PATH = "$Node22Portable;$env:PATH"
    Write-Host "Using portable Node.js 22 for local validation: $(node --version)"
}

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "=== $Message ===" -ForegroundColor Cyan
}
function Invoke-Check([string]$Name, [scriptblock]$Action) {
    Write-Step $Name
    try {
        & $Action
        if ($LASTEXITCODE -ne 0) { throw "Command exit code: $LASTEXITCODE" }
        Write-Host "[PASS] $Name" -ForegroundColor Green
    } catch {
        $Failures.Add("$Name : $($_.Exception.Message)")
        Write-Host "[FAIL] $Name : $($_.Exception.Message)" -ForegroundColor Red
    }
}
try {
    Set-Location -LiteralPath $ProjectRoot
    Write-Host 'dianGarden local validation'
    Write-Host "Project: $ProjectRoot"
    Write-Host 'This script does not deploy to GitHub Pages or Cloudflare.'
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required. This script does not install tools.' }
    $PythonCommand = if (Get-Command python -ErrorAction SilentlyContinue) { 'python' } elseif (Get-Command py -ErrorAction SilentlyContinue) { 'py' } else { $null }
    if (-not $PythonCommand) { throw 'Python is required. This script does not install tools.' }

    Invoke-Check 'Cloudflare Worker API smoke test' {
        node tests/cloudflare-worker-smoke.mjs
    }
    Invoke-Check 'JavaScript/MJS syntax checks' {
        $Files = @(
            Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'src') -Recurse -File | Where-Object { $_.Extension -in '.js', '.mjs' }
            Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'tests') -Recurse -File | Where-Object { $_.Extension -in '.js', '.mjs' }
            Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'cloudflare') -Recurse -File | Where-Object { $_.Extension -in '.js', '.mjs' }
        )
        foreach ($File in $Files) {
            node --check $File.FullName
            if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $($File.FullName)" }
        }
        Write-Host "Checked $($Files.Count) JavaScript/MJS files."
    }

    if ($SkipBrowser) {
        Write-Host 'Browser tests skipped by -SkipBrowser.'
    } else {
        node --input-type=module -e "import fs from 'node:fs'; import('playwright').then(({ chromium }) => { const p = chromium.executablePath(); if (!fs.existsSync(p)) { console.error('Playwright Chromium is missing: ' + p); process.exit(3); } console.log('Playwright and Chromium are available'); }).catch(() => process.exit(2))"
        $PlaywrightAvailable = ($LASTEXITCODE -eq 0)
        if (-not $PlaywrightAvailable) {
            $Failures.Add('Browser validation blocked: Playwright and its Chromium browser are required. Get user approval before installing either.')
            Write-Host '[BLOCKED] Playwright package or Chromium browser is missing. No tools were installed.' -ForegroundColor Yellow
        } else {
            Write-Step 'Prepare isolated browser-test workspace'
            if (Test-Path -LiteralPath $Workspace) { Remove-Item -LiteralPath $Workspace -Recurse -Force }
            New-Item -ItemType Directory -Path $Workspace | Out-Null
            foreach ($Name in @('src', 'assets', 'cloudflare', 'tests', 'scripts')) {
                Copy-Item -LiteralPath (Join-Path $ProjectRoot $Name) -Destination $Workspace -Recurse
            }
            $AssetRoot = Join-Path $Workspace 'src\assets'
            New-Item -ItemType Directory -Force -Path (Join-Path $AssetRoot 'flowers'), (Join-Path $AssetRoot 'btn') | Out-Null
            Copy-Item -Path (Join-Path $Workspace 'assets\flowers\*.png') -Destination (Join-Path $AssetRoot 'flowers') -Force
            Copy-Item -LiteralPath (Join-Path $Workspace 'assets\wreath.webp') -Destination (Join-Path $AssetRoot 'wreath.webp') -Force
            Copy-Item -Path (Join-Path $Workspace 'assets\btn\*.png') -Destination (Join-Path $AssetRoot 'btn') -Force
            $RootPngs = Get-ChildItem -LiteralPath (Join-Path $Workspace 'assets') -Filter '*.png' -File
            foreach ($Asset in $RootPngs) {
                Copy-Item -LiteralPath $Asset.FullName -Destination (Join-Path $AssetRoot $Asset.Name) -Force
            }
            $VersionFile = Join-Path $Workspace 'src\version.json'
            $BuildVersionSource = Get-Content -LiteralPath (Join-Path $Workspace 'src\build-version.js') -Raw
            if ($BuildVersionSource -notmatch "window\.__DIANGARDEN_BUILD_VERSION__\s*=\s*'([^']+)'") {
                throw 'Could not read the current build version for the isolated test workspace.'
            }
            $LocalVersion = $Matches[1]
            $VersionPayload = @{
                version = $LocalVersion
                taipei_date = 'local'
                daily_update_number = 0
            } | ConvertTo-Json
            Set-Content -LiteralPath $VersionFile -Value $VersionPayload -Encoding utf8
            & $PythonCommand (Join-Path $Workspace 'scripts\version-assets.py') (Join-Path $Workspace 'src\index.html') $VersionFile
            if ($LASTEXITCODE -ne 0) { throw 'Failed to prepare versioned asset URLs.' }

            $ServerProcess = Start-Process -FilePath $PythonCommand -ArgumentList @('-m', 'http.server', '4173', '--directory', $Workspace) -PassThru -WindowStyle Hidden
            $Ready = $false
            for ($Attempt = 0; $Attempt -lt 20; $Attempt++) {
                Start-Sleep -Milliseconds 500
                try {
                    $Response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4173/src/index.html' -TimeoutSec 2
                    if ($Response.StatusCode -eq 200) { $Ready = $true; break }
                } catch {}
            }
            if (-not $Ready) { throw 'Local test server did not start within 10 seconds.' }
            $env:GARDEN_TEST_URL = 'http://127.0.0.1:4173/src'
            $env:GARDEN_TEST_LOCAL = '1'
            $BrowserLog = Join-Path $Workspace 'browser-test.log'
            Push-Location -LiteralPath $Workspace
            try {
                node (Join-Path $Workspace 'tests\browser-smoke.mjs') *> $BrowserLog
                $BrowserExitCode = $LASTEXITCODE
                Get-Content -LiteralPath $BrowserLog
                if ($BrowserExitCode -ne 0) {
                    Copy-Item -LiteralPath $BrowserLog -Destination (Join-Path $ProjectRoot 'logs\local-browser-test.log') -Force
                    throw "Playwright browser smoke test failed (exit code $BrowserExitCode); output saved to logs/local-browser-test.log."
                }
            } finally {
                Pop-Location
            }
            Write-Host '[PASS] Playwright browser smoke test' -ForegroundColor Green
        }
    }
} catch {
    $Failures.Add($_.Exception.Message)
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
} finally {
    if ($ServerProcess -and -not $ServerProcess.HasExited) { Stop-Process -Id $ServerProcess.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item Env:\GARDEN_TEST_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\GARDEN_TEST_LOCAL -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $Workspace) { Remove-Item -LiteralPath $Workspace -Recurse -Force -ErrorAction SilentlyContinue }
    Set-Location $OriginalLocation
}
Write-Host ''
Write-Host '=== Local validation summary ==='
if ($Failures.Count -eq 0) {
    Write-Host 'PASS: all selected checks passed.' -ForegroundColor Green
    exit 0
}
foreach ($Failure in $Failures) { Write-Host "- $Failure" -ForegroundColor Red }
Write-Host 'Not all checks passed. Review the output and obtain any required approval.' -ForegroundColor Yellow
exit 1

[executed on device: CharMing (07eaf469-ae47-42c9-b1a6-f9ac76863107)]