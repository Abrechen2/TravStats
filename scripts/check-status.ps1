$root    = Split-Path -Parent $PSScriptRoot
$version = (Get-Content "$root\backend\VERSION").Trim()
$branch  = git -C $root rev-parse --abbrev-ref HEAD
$dirty   = (git -C $root status --short | Measure-Object -Line).Lines

Write-Host "=== TravStats Status ===" -ForegroundColor Cyan
Write-Host "Version  : $version"
Write-Host "Branch   : $branch"
Write-Host "Uncommitted: $dirty Datei(en)"
Write-Host ""
Write-Host "--- TypeScript ---"
Set-Location "$root\backend";  npx tsc --noEmit 2>&1 | Select-Object -Last 1
Set-Location "$root\frontend"; npx tsc --noEmit 2>&1 | Select-Object -Last 1
Write-Host ""
Write-Host "--- Frontend Tests ---"
Set-Location "$root\frontend"; npx vitest --run 2>&1 | Select-Object -Last 3
Set-Location $root
Write-Host "===========================" -ForegroundColor Cyan
