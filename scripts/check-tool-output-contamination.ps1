[CmdletBinding()]
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$SelfTest
)
$ErrorActionPreference = 'Stop'

# Build the marker in pieces so this checker does not flag its own source.
$Marker = '[' + 'executed on device:'
$CodeExtensions = @('.ps1', '.psm1', '.js', '.mjs', '.cjs', '.html', '.css', '.json', '.py', '.yml', '.yaml', '.sql', '.toml')
$ExcludedDirectories = @('.git', 'node_modules', 'test-results', '.local-test-workspace', 'dist', 'build')

function Find-Contamination([string]$Root) {
    $Hits = [System.Collections.Generic.List[string]]::new()
    $Files = Get-ChildItem -LiteralPath $Root -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
            $CurrentFile = $_
            $CurrentFile.Extension.ToLowerInvariant() -in $CodeExtensions -and
            -not ($ExcludedDirectories | Where-Object { $CurrentFile.FullName -like ('*\' + $_ + '\*') })
        }
    foreach ($File in $Files) {
        Select-String -LiteralPath $File.FullName -SimpleMatch $Marker -ErrorAction SilentlyContinue | ForEach-Object {
            $Hits.Add(('{0}:{1}' -f $_.Path, $_.LineNumber))
        }
    }
    return $Hits
}

if ($SelfTest) {
    $TempRoot = Join-Path ([IO.Path]::GetTempPath()) ('dianGarden-contamination-test-' + [guid]::NewGuid().ToString('N'))
    try {
        New-Item -ItemType Directory -Path $TempRoot | Out-Null
        $Probe = Join-Path $TempRoot 'probe.js'
        Set-Content -LiteralPath $Probe -Value ($Marker + ' test-device)') -Encoding utf8
        $Hits = @(Find-Contamination $TempRoot)
        if ($Hits.Count -ne 1) { throw 'Self-test failed: contaminated sample was not detected.' }
        Set-Content -LiteralPath $Probe -Value 'const healthy = true;' -Encoding utf8
        $Hits = @(Find-Contamination $TempRoot)
        if ($Hits.Count -ne 0) { throw 'Self-test failed: clean sample was incorrectly flagged.' }
        Write-Host '[PASS] Contamination checker positive and negative self-tests.'
    } finally {
        Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    exit 0
}

$Results = @(Find-Contamination $ProjectRoot)
if ($Results.Count -gt 0) {
    Write-Host '[FAIL] Tool-output contamination found:' -ForegroundColor Red
    $Results | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    exit 1
}
Write-Host '[PASS] No tool-output contamination found in project code/config files.' -ForegroundColor Green
exit 0
