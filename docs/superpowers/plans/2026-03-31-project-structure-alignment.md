# Project Structure Alignment (Sublarr → TravStats) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Sublarr's proven project structure to TravStats — monorepo orchestration, GitHub workflows (Release, Claude, Dependabot), new dev/ops scripts, a reworked CLAUDE.md, and supplementary project documentation.

**Architecture:** No code logic changes. All changes are infrastructure: package.json, shell scripts, GitHub Actions workflows, Markdown docs. Machine-specific deployment information is moved into `CLAUDE.local.md` (gitignored).

**Tech Stack:** bash/PowerShell, GitHub Actions, Conventional Commits, Keep a Changelog, Semantic Versioning

---

## Overview of affected files

| Action | File | Purpose |
|--------|-------|-------|
| Modify | `package.json` (root) | Monorepo orchestration: dev, install:all, test |
| Create | `scripts/dev-all.sh` + `.ps1` | Starts backend + frontend in parallel |
| Create | `scripts/check-status.sh` + `.ps1` | Health check: build, tests, git status, version |
| Create | `scripts/run-tests.sh` + `.ps1` | All tests (backend + frontend + e2e) |
| Create | `scripts/security-scan.sh` | npm audit + bandit on scripts/ |
| Create | `.github/workflows/release.yml` | Tag → CI → Docker → GitHub Release |
| Create | `.github/workflows/claude.yml` | @claude mentions in issues/PRs |
| Create | `.github/workflows/claude-code-review.yml` | Auto-review on PR open/sync |
| Create | `.github/dependabot.yml` | Weekly dependency updates |
| Modify | `CLAUDE.md` | Sublarr style: precise, action-focused, with gotchas |
| Create | `CLAUDE.local.md.example` | Template for machine-specific deployment info |
| Modify | `.gitignore` | Ignore CLAUDE.local.md + .claude/settings.json |
| Create | `CONTRIBUTING.md` | Contribution guide (branch, PR, commit format) |
| Create | `docs/INCIDENT_RUNBOOK.md` | Step-by-step procedure for production outages |
| Create | `docs/LEARNINGS.md` | Recorded insights from bugs/reviews |

---

## Task 1: Root `package.json` — Monorepo orchestration

**Files:**
- Modify: `package.json` (root)

- [ ] **Write the new root `package.json`**

```json
{
  "name": "travstats",
  "version": "0.9.0-beta",
  "private": true,
  "scripts": {
    "dev": "concurrently -n \"backend,frontend\" -c \"cyan,yellow\" \"npm run dev:backend\" \"npm run dev:frontend\"",
    "dev:backend": "cd backend && npm run dev",
    "dev:frontend": "cd frontend && npm run dev",
    "build": "cd frontend && npm run build",
    "install:all": "cd backend && npm install && cd ../frontend && npm install",
    "test": "npm run test:backend && npm run test:frontend",
    "test:backend": "cd backend && npm test -- --forceExit",
    "test:frontend": "cd frontend && npx vitest --run",
    "test:e2e": "playwright test",
    "lint": "npm run lint:backend && npm run lint:frontend",
    "lint:backend": "cd backend && npm run lint",
    "lint:frontend": "cd frontend && npm run lint",
    "typecheck": "npm run typecheck:backend && npm run typecheck:frontend",
    "typecheck:backend": "cd backend && npx tsc --noEmit",
    "typecheck:frontend": "cd frontend && npx tsc --noEmit"
  },
  "devDependencies": {
    "@playwright/test": "^1.57.0",
    "concurrently": "^9.1.2"
  }
}
```

- [ ] **Install concurrently**

```bash
cd /d/Projekte/TravStats && npm install --save-dev concurrently
```

- [ ] **Verify: `npm run typecheck` passes**

```bash
cd /d/Projekte/TravStats && npm run typecheck
```

Expected: Both type checks succeed, no errors.

- [ ] **Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: root package.json als Monorepo-Orchestrator mit dev/test/lint scripts"
```

---

## Task 2: Scripts — Dev & Ops

**Files:**
- Create: `scripts/dev-all.sh`, `scripts/dev-all.ps1`
- Create: `scripts/check-status.sh`, `scripts/check-status.ps1`
- Create: `scripts/run-tests.sh`, `scripts/run-tests.ps1`
- Create: `scripts/security-scan.sh`

- [ ] **Create `scripts/dev-all.sh`**

```bash
#!/bin/bash
# Startet Backend (Port 8000) und Frontend (Port 3000) parallel.
# Beendet beide bei CTRL+C.
set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "TravStats Dev — Backend :8000 | Frontend :3000"
echo "Stoppen mit CTRL+C"
echo ""
(cd "$REPO_ROOT/backend" && npm run dev) &
BACKEND_PID=$!
(cd "$REPO_ROOT/frontend" && npm run dev) &
FRONTEND_PID=$!
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
```

- [ ] **Create `scripts/dev-all.ps1`**

```powershell
# Startet Backend (Port 8000) und Frontend (Port 3000) parallel.
$root = Split-Path -Parent $PSScriptRoot
Write-Host "TravStats Dev — Backend :8000 | Frontend :3000" -ForegroundColor Cyan
$backend  = Start-Process "npm" -ArgumentList "run","dev" -WorkingDirectory "$root\backend"  -PassThru
$frontend = Start-Process "npm" -ArgumentList "run","dev" -WorkingDirectory "$root\frontend" -PassThru
Write-Host "PIDs — Backend: $($backend.Id)  Frontend: $($frontend.Id)" -ForegroundColor Green
Write-Host "Beide Prozesse stoppen: taskkill /F /PID $($backend.Id) /PID $($frontend.Id)"
Wait-Process -Id $backend.Id, $frontend.Id
```

- [ ] **Create `scripts/check-status.sh`**

```bash
#!/bin/bash
# Zeigt: Version, Git-Status, TypeScript-Fehler, Test-Summary.
set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION=$(cat "$REPO_ROOT/backend/VERSION" | tr -d '\r\n')
echo "=== TravStats Status ==="
echo "Version  : $VERSION"
echo "Branch   : $(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
echo "Uncommitted: $(git -C "$REPO_ROOT" status --short | wc -l | tr -d ' ') Datei(en)"
echo ""
echo "--- TypeScript ---"
cd "$REPO_ROOT/backend" && npx tsc --noEmit && echo "Backend  : ✓" || echo "Backend  : ✗ Fehler"
cd "$REPO_ROOT/frontend" && npx tsc --noEmit && echo "Frontend : ✓" || echo "Frontend : ✗ Fehler"
echo ""
echo "--- Lint ---"
cd "$REPO_ROOT/backend" && npm run lint --silent && echo "Backend  : ✓" || echo "Backend  : ✗ Fehler"
cd "$REPO_ROOT/frontend" && npm run lint --silent && echo "Frontend : ✓" || echo "Frontend : ✗ Fehler"
echo ""
echo "--- Frontend Tests ---"
cd "$REPO_ROOT/frontend" && npx vitest --run --reporter=verbose 2>&1 | tail -5
echo ""
echo "==========================="
```

- [ ] **Create `scripts/check-status.ps1`**

```powershell
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
```

- [ ] **Create `scripts/run-tests.sh`**

```bash
#!/bin/bash
# Führt alle Tests aus: Backend (benötigt DB), Frontend, E2E (optional).
set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_E2E="${SKIP_E2E:-false}"

echo "=== Frontend Tests (Vitest) ==="
cd "$REPO_ROOT/frontend" && npx vitest --run

echo ""
echo "=== Backend Tests (Jest + DB) ==="
echo "HINWEIS: Benötigt laufende PostgreSQL-Instanz."
cd "$REPO_ROOT/backend" && npm test -- --forceExit

if [ "$SKIP_E2E" != "true" ]; then
  echo ""
  echo "=== E2E Tests (Playwright) ==="
  echo "HINWEIS: Benötigt laufenden Dev-Server (npm run dev)."
  cd "$REPO_ROOT" && npx playwright test
fi
echo ""
echo "=== Alle Tests abgeschlossen ==="
```

- [ ] **Create `scripts/run-tests.ps1`**

```powershell
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
```

- [ ] **Create `scripts/security-scan.sh`**

```bash
#!/bin/bash
# Security-Scan: npm audit (frontend + backend) + bandit auf Python-Scripts.
set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0

echo "=== Backend npm audit ==="
cd "$REPO_ROOT/backend" && npm audit --audit-level=high || FAILED=1

echo ""
echo "=== Frontend npm audit ==="
cd "$REPO_ROOT/frontend" && npm audit --audit-level=high || FAILED=1

echo ""
echo "=== Bandit (Python scripts) ==="
if command -v bandit &>/dev/null; then
  bandit -r "$REPO_ROOT/backend/src/scripts/" -c "$REPO_ROOT/.bandit.yml" || FAILED=1
else
  echo "bandit nicht installiert — übersprungen (pip install bandit)"
fi

if [ "$FAILED" -eq 1 ]; then
  echo ""
  echo "✗ Security-Scan: Probleme gefunden — bitte prüfen!"
  exit 1
fi
echo ""
echo "✓ Security-Scan abgeschlossen — keine High/Critical gefunden."
```

- [ ] **Make shell scripts executable**

```bash
chmod +x /d/Projekte/TravStats/scripts/dev-all.sh
chmod +x /d/Projekte/TravStats/scripts/check-status.sh
chmod +x /d/Projekte/TravStats/scripts/run-tests.sh
chmod +x /d/Projekte/TravStats/scripts/security-scan.sh
```

- [ ] **Commit**

```bash
git add scripts/
git commit -m "chore: dev-all, check-status, run-tests, security-scan scripts hinzugefügt"
```

---

## Task 3: GitHub workflow — `release.yml`

**Files:**
- Create: `.github/workflows/release.yml`

The workflow: pushing a `v*.*.*` tag → CI (reuse) → Docker build → GitHub Release with CHANGELOG extraction.

- [ ] **Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags: ['v*.*.*']
  workflow_dispatch:
    inputs:
      tag:
        description: 'Tag to release (e.g. v0.9.1)'
        required: true

concurrency:
  group: release
  run-name: Release ${{ github.ref_name }}

jobs:
  validate:
    name: Validate VERSION vs Tag
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.check.outputs.version }}
      prerelease: ${{ steps.check.outputs.prerelease }}
    steps:
      - uses: actions/checkout@v4

      - name: Check VERSION matches tag
        id: check
        run: |
          TAG="${{ github.ref_name }}"
          TAG="${TAG:-v${{ inputs.tag }}}"
          VERSION=$(cat backend/VERSION | tr -d '\r\n')
          EXPECTED="v${VERSION}"
          if [ "$TAG" != "$EXPECTED" ]; then
            echo "ERROR: Tag '$TAG' stimmt nicht mit backend/VERSION '$VERSION' überein."
            echo "Bitte erst backend/VERSION auf die neue Version setzen und committen."
            exit 1
          fi
          echo "version=$VERSION" >> $GITHUB_OUTPUT
          if echo "$VERSION" | grep -qE '(alpha|beta|rc)'; then
            echo "prerelease=true" >> $GITHUB_OUTPUT
          else
            echo "prerelease=false" >> $GITHUB_OUTPUT
          fi

  ci:
    name: CI
    needs: validate
    uses: ./.github/workflows/ci.yml

  docker:
    name: Build & Push Docker
    needs: [validate, ci]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:${{ needs.validate.outputs.version }}
            ghcr.io/${{ github.repository }}:latest
          build-args: VERSION=${{ needs.validate.outputs.version }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  release:
    name: Create GitHub Release
    needs: [validate, docker]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - name: Extract CHANGELOG section
        id: changelog
        run: |
          VERSION="${{ needs.validate.outputs.version }}"
          # Extract section between ## [VERSION] and next ## [
          NOTES=$(awk "/^## \[$VERSION\]/{found=1; next} found && /^## \[/{exit} found{print}" CHANGELOG.md)
          if [ -z "$NOTES" ]; then
            NOTES="Siehe [CHANGELOG.md](CHANGELOG.md) für Details."
          fi
          # Multiline output
          {
            echo "notes<<EOF"
            echo "$NOTES"
            echo "EOF"
          } >> $GITHUB_OUTPUT

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: v${{ needs.validate.outputs.version }}
          name: TravStats v${{ needs.validate.outputs.version }}
          body: ${{ steps.changelog.outputs.notes }}
          prerelease: ${{ needs.validate.outputs.prerelease }}
          generate_release_notes: false
```

- [ ] **Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: release workflow (validate VERSION → CI → Docker → GitHub Release)"
```

---

## Task 4: GitHub workflows — Claude & Dependabot

**Files:**
- Create: `.github/workflows/claude.yml`
- Create: `.github/workflows/claude-code-review.yml`
- Create: `.github/dependabot.yml`

- [ ] **Create `.github/workflows/claude.yml`**

```yaml
name: Claude

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

jobs:
  claude:
    if: contains(github.event.comment.body, '@claude')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Create `.github/workflows/claude-code-review.yml`**

```yaml
name: Claude Code Review

on:
  pull_request:
    types: [opened, synchronize, ready_for_review]

jobs:
  review:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          direct_prompt: |
            Review this PR for TravStats (Express/TypeScript backend + React/TypeScript frontend).
            Focus on: TypeScript type safety (no `any`), security issues, breaking API contracts,
            and logic errors. Skip style nitpicks already caught by ESLint/Prettier.
            Be concise — only report issues that actually matter.
```

- [ ] **Create `.github/dependabot.yml`**

```yaml
version: 2
updates:
  # Backend (npm)
  - package-ecosystem: npm
    directory: /backend
    schedule:
      interval: weekly
      day: monday
    groups:
      minor-patch:
        update-types: [minor, patch]
    open-pull-requests-limit: 5
    labels: [dependencies, backend]

  # Frontend (npm)
  - package-ecosystem: npm
    directory: /frontend
    schedule:
      interval: weekly
      day: monday
    groups:
      minor-patch:
        update-types: [minor, patch]
    open-pull-requests-limit: 5
    labels: [dependencies, frontend]

  # GitHub Actions
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
    groups:
      actions:
        patterns: ['*']
    open-pull-requests-limit: 3
    labels: [dependencies, ci]
```

- [ ] **Commit**

```bash
git add .github/workflows/claude.yml .github/workflows/claude-code-review.yml .github/dependabot.yml
git commit -m "ci: Claude workflows (@mention + auto code-review) und Dependabot hinzugefügt"
```

---

## Task 5: CLAUDE.md — Sublarr-inspired rewrite

**Files:**
- Modify: `CLAUDE.md`

CLAUDE.md becomes shorter, action-focused, with critical gotchas and a deployment section. Machine-specific information (server IP, etc.) moves into `CLAUDE.local.md` (gitignored).

- [ ] **Replace `CLAUDE.md` entirely**

```markdown
# TravStats

Flight tracker — Express/TypeScript backend + React/Vite/TypeScript frontend.

## Dev Commands

\```bash
# Alles installieren
npm run install:all

# Backend + Frontend gleichzeitig starten
npm run dev           # oder: scripts/dev-all.sh

# Einzeln
npm run dev:backend   # Port 8000
npm run dev:frontend  # Port 3000
\```

## Build-Checks (PFLICHT vor jedem PR/Commit)

\```bash
# Backend
cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit

# Frontend
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
\```

## Docker & Deployment

Deployment-Details (Server-IP, SSH-Befehle, Compose-Pfade) → **`CLAUDE.local.md`** (gitignored, lokal anlegen).

\```bash
# Lokal bauen (Docker Desktop muss laufen)
VERSION=$(cat backend/VERSION)
bash scripts/docker-build.sh   # oder: scripts/docker-build.ps1

# Versionierung: backend/VERSION erhöhen → commit → Tag pushen
echo "0.9.1" > backend/VERSION
git add backend/VERSION && git commit -m "chore: bump version to 0.9.1"
git tag v0.9.1 && git push origin v0.9.1   # startet release.yml
\```

## Commit Requirement

**Every change must be committed before the session ends.**

## PR Workflow (CRITICAL)

1. **No merge without green CI.** Before every merge: `gh pr checks <number>` — all checks green. No `--admin` bypass.
2. **Always show changes before merge.** Present a summary and wait for explicit confirmation before merging into `Main` or deploying to prod.

## Architecture

\```
backend/src/
  index.ts          # Express app entry
  routes/           # Route handlers — one file per domain
  middleware/       # auth, rateLimit, error
  services/         # Business logic
  schemas/          # Zod validation schemas
  utils/            # Helpers (logger, password, etc.)
  db.ts             # Prisma client singleton

frontend/src/
  pages/            # Route-level components
  components/       # Reusable UI components
  store/            # Zustand state stores
  lib/              # API client (api.ts), logger
  hooks/            # Custom React hooks
  i18n/             # react-i18next translations (de/en)
\```

## Critical Gotchas

- **`any` is FORBIDDEN** — always use `unknown` + type guards. Exception: `.d.ts` files.
- **Pino logger** — no `console.log`. Import: `import { logger } from '../utils/logger'`
- **Prisma JSON fields** — cast via `as unknown as Prisma.InputJsonValue`, never directly from `Record<string, unknown>`
- **deck.gl + MapLibre** — use the `MapboxOverlay` + `useControl` pattern (NOT the `<DeckGL>` React component — WebGL conflict with MapLibre 5.x)
- **GeoJSON coordinates** — come from `geometry.coordinates` (LineString), NOT from `departureAirport.lat/lon` (unpopulated)
- **Auth cookie** — the JWT is an HttpOnly cookie (not a bearer token). `withCredentials: true` on every Axios instance.
- **Prisma migrations** — schema changes always via `npx prisma migrate dev` (never manually)
- **React hooks** — `useTranslation` is imported from `'../hooks/useTranslation'` (a project wrapper), not directly from `react-i18next`
- **Zod** — mandatory for all user input and API requests. Schemas live in `backend/src/schemas/`.

## Code Style

- TypeScript: `strict: true`, ESLint + Prettier (printWidth 100, `singleQuote: false`)
- Async: always `async/await`, never `.then()`
- Immutability: spread `{...obj, field: value}`, no in-place mutation
- Error handling: explicit at every level, never swallow silently
- File sizes: 200–400 lines ideal, **800 lines hard maximum**

## Version

Source of truth: `backend/VERSION` (currently: `0.9.0-beta`)

Cutting a new release:
1. Update `backend/VERSION` to the new version
2. Update `CHANGELOG.md` (Unreleased → new section)
3. Commit and push tag `v{VERSION}` → `release.yml` starts automatically

Suggestion script: `scripts/suggest-next-version.sh` / `.ps1`

## Security

- Validate all user input via **Zod schemas** (system boundaries)
- Rate limiting on every auth and expensive endpoint (`express-rate-limit`)
- No hardcoded secrets — `.env` file (gitignored), in the container via a secrets volume
- JWT in an HttpOnly cookie (never `localStorage`)
- XSS: React escapes automatically; no `dangerouslySetInnerHTML`
- SQL injection: Prisma ORM (parameterised queries)
- Security scan: `scripts/security-scan.sh`

Security findings: `PENTEST_FINDINGS.md` (when present)

## Testing

\```bash
# Frontend (Vitest, no DB required)
cd frontend && npx vitest --run

# Backend (Jest, requires PostgreSQL)
cd backend && npm test -- --forceExit

# E2E (Playwright, requires a running dev server)
npx playwright test

# Everything at once
bash scripts/run-tests.sh   # alternative: scripts/run-tests.ps1
\```

## Monitoring & Logs

- Logs in `data/logs/` (`app.log`, `error.log`, `http.log`, `parser*.log`)
- Pino structured JSON — the `LOG_LEVEL` env var controls verbosity
- Health check: `GET /api/v1/health`

## Machine-specific Info

→ See **`CLAUDE.local.md`** for: server IP (Underworld), SSH paths, Docker Compose paths, local port mappings.
```

- [ ] **Commit**

```bash
git add CLAUDE.md
git commit -m "docs: rewrite CLAUDE.md along the Sublarr template (tighter, gotchas, deployment split)"
```

---

## Task 6: CLAUDE.local.md — Machine-specific deployment info

**Files:**
- Create: `CLAUDE.local.md.example`
- Modify: `.gitignore`

- [ ] **Create `CLAUDE.local.md.example`**

```markdown
# CLAUDE.local.md — Maschinen-spezifische Deployment-Infos
# Diese Datei NICHT committen (gitignored).
# Kopieren nach CLAUDE.local.md und befüllen.

## Deployment: Underworld (Produktionsserver)

\```bash
SERVER_IP="<UNDERWORLD_IP>"        # z.B. 192.168.178.xxx
DEPLOY_PATH="/opt/travstats"       # Pfad auf dem Server

# 1. Neues Image bauen und pushen (lokal, Docker Desktop muss laufen)
VERSION=$(cat backend/VERSION)
bash scripts/docker-build.sh

# 2. Auf Server deployen
ssh root@$SERVER_IP "cd $DEPLOY_PATH && docker compose pull && docker compose up -d"

# 3. Alte Images aufräumen (verhindert Disk Full)
ssh root@$SERVER_IP "docker system prune -f"

# 4. Verifizieren
curl -s http://$SERVER_IP:3000/api/v1/health
\```

## Lokale Umgebung

- Backend .env: `backend/.env`
- Postgres: localhost:5432, DB: travstats, User: travstats
- Ollama: http://localhost:11434

## Fallback: Build auf Server (wenn Docker Desktop nicht läuft)

\```bash
cd /d/Projekte/TravStats && tar -czf - \
  --exclude='.git' --exclude='node_modules' --exclude='dist' \
  . | ssh root@$SERVER_IP "cd /tmp && rm -rf ts-build && mkdir ts-build && tar -xzf - -C ts-build"
ssh root@$SERVER_IP "cd /tmp/ts-build && docker build -t ghcr.io/abrechen2/travstats:$VERSION --build-arg VERSION=$VERSION ."
\```
```

- [ ] **Extend `.gitignore`** with CLAUDE.local.md and project-level Claude settings

```bash
# Diese Zeilen an .gitignore anhängen
cat >> /d/Projekte/TravStats/.gitignore << 'EOF'

# Maschinen-spezifische Konfiguration (nie committen)
CLAUDE.local.md
.claude/settings.json
EOF
```

- [ ] **Commit**

```bash
git add CLAUDE.local.md.example .gitignore
git commit -m "docs: CLAUDE.local.md.example für Deployment-Infos + .gitignore Einträge"
```

---

## Task 7: CONTRIBUTING.md

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Create `CONTRIBUTING.md`**

```markdown
# Contributing to TravStats

## Branches

| Branch | Zweck |
|--------|-------|
| `Main` | Stabile Produktionsbasis — nur via PR |
| `feature/...` | Neue Features |
| `fix/...` | Bugfixes |
| `chore/...` | Infrastruktur, Deps, Refactoring ohne Feature-Impact |

## Workflow

1. Branch von `Main` erstellen
2. Änderungen committen (Conventional Commits, s.u.)
3. Build-Checks lokal ausführen: `npm run typecheck && npm run lint`
4. PR nach `Main` öffnen — CI muss grün sein
5. Kein Merge ohne Review und grünes CI

## Commit-Format (Conventional Commits)

\```
<type>: <kurze Beschreibung>

[optionaler Body]
\```

| Type | Wann |
|------|------|
| `feat` | Neues Feature |
| `fix` | Bugfix |
| `chore` | Build, CI, Deps (kein Feature/Fix) |
| `docs` | Nur Dokumentation |
| `refactor` | Kein Feature, kein Fix — Code-Struktur |
| `perf` | Performance-Verbesserung |
| `test` | Tests hinzufügen/korrigieren |
| `ci` | CI/CD-Änderungen |

Beispiele:
\```
feat: Email-Import als primären Tab in Flug-hinzufügen-Modal
fix: authStore 401-Handler nach Store-Hydration wiederherstellen
chore: Abhängigkeiten auf aktuelle Versionen aktualisiert
\```

## Versionierung

Semantic Versioning: `MAJOR.MINOR.PATCH[-prerelease]`

- **MAJOR** — Breaking Changes (API, DB-Schema)
- **MINOR** — Neue Features, rückwärtskompatibel
- **PATCH** — Bugfixes

Vorschlag berechnen: `bash scripts/suggest-next-version.sh`

## Release-Prozess

1. `backend/VERSION` auf neue Version setzen
2. `CHANGELOG.md` aktualisieren — Unreleased → `[VERSION] - YYYY-MM-DD`
3. `package.json` (root + frontend + backend) version-Feld aktualisieren
4. Commit: `chore: bump version to X.Y.Z`
5. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
6. `release.yml` Workflow startet automatisch (CI → Docker → GitHub Release)

## Code-Standards

Siehe [CLAUDE.md](CLAUDE.md) für vollständige Regeln.
Kurzfassung: kein `any`, Pino statt `console.log`, Immutability, Zod für Validierung.

## Sicherheit

Sicherheitslücken bitte **nicht** als öffentliches Issue melden.
Stattdessen direkt an den Maintainer.
```

- [ ] **Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: CONTRIBUTING.md mit Branch-Workflow, Commit-Format und Release-Prozess"
```

---

## Task 8: Docs — INCIDENT_RUNBOOK & LEARNINGS

**Files:**
- Create: `docs/INCIDENT_RUNBOOK.md`
- Create: `docs/LEARNINGS.md`

- [ ] **Create `docs/INCIDENT_RUNBOOK.md`**

```markdown
# TravStats — Incident Runbook

Schritt-für-Schritt bei Produktionsausfällen.

## 1. Erster Check (< 2 Minuten)

\```bash
# Health-Check
curl -s http://<SERVER_IP>:3000/api/v1/health

# Container-Status
ssh root@<SERVER_IP> "cd /opt/travstats && docker compose ps"

# Letzte Logs
ssh root@<SERVER_IP> "docker compose logs --tail=100 app"
\```

## 2. Häufige Probleme

### App startet nicht / gibt 500 zurück

\```bash
# Logs lesen
ssh root@<SERVER_IP> "docker compose logs app | grep -i error"

# Umgebungsvariablen prüfen (JWT_SECRET, DATABASE_URL)
ssh root@<SERVER_IP> "docker compose config app | grep -i env"

# Datenbankverbindung prüfen
ssh root@<SERVER_IP> "docker compose exec app npx prisma db status"
\```

### Datenbank nicht erreichbar

\```bash
# Postgres-Container läuft?
ssh root@<SERVER_IP> "docker compose ps db"

# Healthcheck-Log
ssh root@<SERVER_IP> "docker inspect --format='{{json .State.Health}}' travstats_db_1"
\```

### Disk Full

\```bash
# Alte Docker-Images aufräumen
ssh root@<SERVER_IP> "docker system prune -af --volumes"

# Log-Größen prüfen
ssh root@<SERVER_IP> "du -sh /opt/travstats/data/logs/*"
\```

### Reload-Loop (Login → / → /login)

Ursache: JWT-Cookie abgelaufen aber User noch in `auth-storage` localStorage.
Fix: `localStorage.removeItem('auth-storage')` in der Browser-Konsole, dann neu einloggen.
Dauerhafter Fix: `authStore.ts` — `onRehydrateStorage` darf Event-Listener nicht entfernen (bereits gefixt ab 0.9.1).

## 3. Rollback

\```bash
# Auf vorherige Version zurück
PREV_VERSION="0.9.0"
ssh root@<SERVER_IP> "cd /opt/travstats && \
  sed -i 's|travstats:.*|travstats:$PREV_VERSION|g' docker-compose.prod.yml && \
  docker compose pull && docker compose up -d"
\```

## 4. Nach Incident

- Root Cause in `docs/LEARNINGS.md` festhalten
- Wenn Datenverlust: Backup-Restore via `scripts/backup.sh`
- CI-Tests ergänzen die Schwachstelle abdecken
```

- [ ] **Create `docs/LEARNINGS.md`**

```markdown
# TravStats — Learnings

Festgehaltene Erkenntnisse aus Bugs, Reviews und Incidents.
Neue Einträge oben einfügen.

---

## 2026-03-31 — Auth-Reload-Loop nach Store-Hydration

**Problem:** `onRehydrateStorage` in `authStore.ts` entfernte den `auth:unauthorized` Event-Listener nach der Hydration aber fügte keinen neuen hinzu. Ergebnis: 401-Fehler lösten keinen Logout mehr aus, sondern nur den Fallback-Hard-Reload mit `window.location.href`. Da der User noch in localStorage stand, redirectete `/login` sofort zurück zu `/` → Endlos-Loop.

**Fix:** Event-Listener-Cleanup aus `onRehydrateStorage` entfernt. Der Listener überlebt jetzt die Hydration, da `get()` immer den aktuellen Store-State liefert. Fallback-Timeout von 200ms auf 500ms erhöht + löscht localStorage vor Hard-Reload als Defense-in-Depth.

**Lesson:** Zustand `onRehydrateStorage` nur für echte Cleanup-Logik verwenden — nicht für Event-Listener die dauerhaft gebraucht werden.

---

## 2026-03 — deck.gl + MapLibre WebGL-Konflikt

**Problem:** `<DeckGL>` React-Komponente + MapLibre 5.x erstellen zwei getrennte WebGL-Kontexte → einer wird sofort zerstört.

**Fix:** `MapboxOverlay` + `useControl` Hook aus `@deck.gl/mapbox` — deck.gl rendert als Overlay in MapLibres WebGL-Kontext.

**Lesson:** Bei Map-Bibliotheken immer prüfen ob WebGL-Sharing nötig ist. Nie zwei unabhängige GL-Kontexte auf demselben Canvas.

---

## 2026-02 — Prisma `any` in JSON-Feldern

**Problem:** `Record<string, unknown>` kann nicht direkt zu `Prisma.InputJsonObject` zugewiesen werden (TypeScript-Fehler).

**Fix:** `as unknown as Prisma.InputJsonValue` — zweistufiger Cast über `unknown`.

**Lesson:** Prisma's JSON-Typen sind extra-strikt. Immer `Prisma.InputJsonValue` als Ziel-Typ verwenden.
```

- [ ] **Commit**

```bash
git add docs/INCIDENT_RUNBOOK.md docs/LEARNINGS.md
git commit -m "docs: INCIDENT_RUNBOOK und LEARNINGS hinzugefügt"
```

---

## Task 9: Version synchronization & CHANGELOG

**Files:**
- Modify: `frontend/package.json`, `backend/package.json` (version field alignment check)
- Modify: `CHANGELOG.md` (ensure the format is correct)

- [ ] **Verify version consistency**

```bash
echo "backend/VERSION: $(cat /d/Projekte/TravStats/backend/VERSION)"
echo "backend/package.json: $(node -p "require('./backend/package.json').version")"
echo "frontend/package.json: $(node -p "require('./frontend/package.json').version")"
echo "root/package.json: $(node -p "require('./package.json').version")"
```

Expected: All show `0.9.0-beta`.

- [ ] **Synchronize if they diverge** — `backend/VERSION` is the source of truth. All `package.json` version fields must match it.

- [ ] **Make sure `release.yml` finds the CHANGELOG section**

`CHANGELOG.md` must contain the section `## [0.9.0-beta]` (with square brackets). If it does not yet have `## [0.9.0-beta]` (only `## [Unreleased]`), add it as part of the next release commit.

- [ ] **Commit if changes are required**

```bash
git add CHANGELOG.md backend/package.json frontend/package.json
git commit -m "chore: Versionsfelder synchronisiert auf 0.9.0-beta"
```

---

## Additional suggestions (not part of this plan, but recommended)

These items are not part of the current plan, but would be sensible next steps:

### 1. Stop hook: warn on uncommitted changes
Extend `.claude/settings.json` (gitignored) with a Stop hook that warns when a session ends without a commit:
```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "cd /d/Projekte/TravStats && CHANGED=$(git status --short | wc -l) && if [ \"$CHANGED\" -gt 0 ]; then echo \"⚠️  WARNING: $CHANGED uncommitted file(s) — bitte committen!\"; fi",
        "statusMessage": "Checking for uncommitted changes..."
      }]
    }]
  }
}
```

### 2. Monitoring (Prometheus + Grafana)
TravStats already has `/api/v1/health` — a simple `monitoring/` directory with a Grafana dashboard (similar to Sublarr) would be the next step. Requires `prom-client` in the backend.

### 3. `PENTEST_FINDINGS.md`
If a security review takes place, document findings the same way as in Sublarr.

### 4. Raise Vitest coverage thresholds
Currently: 30% lines / 20% functions. Target (CLAUDE.md requires 80%): increase incrementally to 50% → 70% → 80%.

### 5. Improve pre-commit hook
Extend `.pre-commit-config.yaml` with `detect-private-key` and `check-merge-conflict` (already in Sublarr).

### 6. Update Unraid template
`unraid-template.xml` already exists — keep it current with new env vars (SMTP, Ollama, etc.).

### 7. Wire `LICENSE_WHITELIST.txt` into `license-check.sh`
The script checks whether all dependencies are on the whitelist.
