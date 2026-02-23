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

# Pre-commit hooks (optional)
if (Get-Command pre-commit -ErrorAction SilentlyContinue) {
    Push-Location $RepoRoot
    pre-commit install
    Pop-Location
    Write-Host "    Pre-commit hooks installed."
} else {
    Write-Host "    pre-commit not found - run: pip3 install pre-commit && pre-commit install"
}

Write-Host "=== Setup complete! ===" -ForegroundColor Green
Write-Host "Next steps:"
Write-Host "  1. Copy .env.example to .env and fill in values"
Write-Host "  2. docker compose up -d db"
Write-Host "  3. cd backend && npx prisma migrate dev"
Write-Host "  4. npm run dev (in backend/ and frontend/ separately)"
