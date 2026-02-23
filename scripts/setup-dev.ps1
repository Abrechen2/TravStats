$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")

Write-Host "=== TravStats Dev Setup ===" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js required. Install from https://nodejs.org"
    exit 1
}

Push-Location (Join-Path $RepoRoot "backend")
npm ci
Pop-Location

Push-Location (Join-Path $RepoRoot "frontend")
npm ci
Pop-Location

Push-Location (Join-Path $RepoRoot "backend")
npx prisma generate
Pop-Location

Write-Host "=== Setup complete! ===" -ForegroundColor Green
Write-Host "Next: copy .env.example to .env, then docker compose up -d db"
