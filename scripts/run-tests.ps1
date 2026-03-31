param([switch]$SkipE2E)
$root = Split-Path -Parent $PSScriptRoot
Write-Host "=== Frontend Tests (Vitest) ===" -ForegroundColor Cyan
Set-Location "$root\frontend"; npx vitest --run
Write-Host ""
Write-Host "=== Backend Tests (Jest + DB) ===" -ForegroundColor Cyan
Write-Host "HINWEIS: Benoetigt laufende PostgreSQL-Instanz."
Set-Location "$root\backend"; npm test -- --forceExit
if (-not $SkipE2E) {
  Write-Host ""
  Write-Host "=== E2E Tests (Playwright) ===" -ForegroundColor Cyan
  Set-Location $root; npx playwright test
}
Write-Host "=== Alle Tests abgeschlossen ===" -ForegroundColor Green
Set-Location $root
