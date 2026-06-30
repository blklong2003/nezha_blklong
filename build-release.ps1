#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Build a release binary with version bump, rename, registry autostart, git tag, and CHANGELOG update.
.DESCRIPTION
    Reads .version (e.g. "0.4.4-my"), bumps the patch number, builds with pnpm + tauri,
    renames the .exe to nezha-v<version>-my.exe, writes autostart registry, creates git tag,
    and appends to CHANGELOG.md.
#>

$ErrorActionPreference = "Stop"

# ---- 1. Read & bump version ----
$versionFile = Join-Path $PSScriptRoot ".version"
$oldVersion = (Get-Content $versionFile -Raw).Trim()

# Parse: "0.4.3.21-my" → parts @("0","4","3","21-my")
$parts = $oldVersion -split '\.'
$base = $parts[0..2] -join '.'   # "0.4.3"
$patchPart = $parts[3]           # "21-my"
$suffix = if ($patchPart -match '^(\d+)-(.+)$') { $Matches[2] } else { "my" }
$patchNum = if ($patchPart -match '^(\d+)') { [int]$Matches[1] } else { 0 }
$patchNum++
$newVersion = "$base.$patchNum-$suffix"

Write-Host "Bumping version: $oldVersion → $newVersion" -ForegroundColor Cyan
Set-Content -Path $versionFile -Value $newVersion -NoNewline

# ---- 2. Update Cargo.toml version ----
$cargoFile = Join-Path $PSScriptRoot "src-tauri" "Cargo.toml"
$cargo = Get-Content $cargoFile -Raw
$cargo = $cargo -replace '^version = "[\d.]+"', "version = `"$base`""
Set-Content -Path $cargoFile -Value $cargo

# ---- 3. pnpm install + build ----
Write-Host "`npnpm install..." -ForegroundColor Cyan
& pnpm install
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }

Write-Host "`nBuild..." -ForegroundColor Cyan
& pnpm tauri build
if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }

# ---- 4. Locate and rename .exe ----
$targetDir = Join-Path $PSScriptRoot "src-tauri" "target" "release"
$originalExe = Join-Path $targetDir "nezha.exe"
$newExeName = "nezha-v$newVersion.exe"
$newExe = Join-Path $targetDir $newExeName

if (Test-Path $originalExe) {
    Copy-Item -Path $originalExe -Destination $newExe -Force
    Write-Host "Renamed: $newExeName" -ForegroundColor Green
} else {
    Write-Warning "nezha.exe not found at $originalExe — skipping rename"
}

# ---- 5. Windows autostart (HKCU) ----
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$regName = "NeZha"
Set-ItemProperty -Path $regPath -Name $regName -Value $newExe.FullName
Write-Host "Autostart registry updated: $regName → $($newExe.FullName)" -ForegroundColor Green

# ---- 6. Git tag ----
try {
    & git tag -f "v$newVersion"
    Write-Host "Tagged: v$newVersion" -ForegroundColor Green
} catch {
    Write-Warning "Git tagging failed: $_"
}

# ---- 7. CHANGELOG ----
$changelogFile = Join-Path $PSScriptRoot "CHANGELOG.md"
$date = Get-Date -Format "yyyy-MM-dd"
$entry = @"

## v$newVersion ($date)

### 构建
- 版本 $newVersion

"@
Add-Content -Path $changelogFile -Value $entry
Write-Host "CHANGELOG.md updated" -ForegroundColor Green

Write-Host "`n✅ Release build complete: $newExeName" -ForegroundColor Green
Write-Host "   Version: $newVersion" -ForegroundColor Green