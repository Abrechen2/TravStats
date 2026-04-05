# Infrastructure Parity with Sublarr - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring TravStats infrastructure to full parity with Sublarr's developer tooling, code quality, and CI/CD setup.

**Architecture:** Each task is independent and adds one infrastructure component. Tasks 1-3 are code-quality tools, Tasks 4-6 are linting/hooks, Task 7 is CI, Task 8 is Docker hardening, Tasks 9-10 are developer experience improvements.

**Tech Stack:** Prettier, ts-prune, @vitest/coverage-v8, ruff, bandit, pre-commit, GitHub Actions, Docker Compose, Bash/PowerShell

---

## Task 1: Add Prettier for Frontend Code Formatting

**Files:**
- Create: `frontend/.prettierrc`
- Create: `frontend/.prettierignore`
- Modify: `frontend/package.json` (add prettier deps + scripts)

**Step 1: Install Prettier**

```bash
cd /d/Projekte/TravStats/frontend
npm install --save-dev prettier
```

Expected: prettier@3.x added to devDependencies

**Step 2: Create .prettierrc**

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": false,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "bracketSpacing": true,
  "arrowParens": "always"
}
```

**Step 3: Create .prettierignore**

```
dist/
node_modules/
*.min.js
```

**Step 4: Add scripts to package.json**

In `frontend/package.json` under `"scripts"`, add:
```json
"format": "prettier --write \"src/**/*.{ts,tsx,css}\"",
"format:check": "prettier --check \"src/**/*.{ts,tsx,css}\""
```

**Step 5: Run format on existing code**

```bash
cd /d/Projekte/TravStats/frontend && npm run format
```

Expected: Files reformatted, no errors

**Step 6: Run build to verify no breakage**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: 0 errors

**Step 7: Commit**

```bash
git add frontend/.prettierrc frontend/.prettierignore frontend/package.json frontend/src/
git commit -m "chore: add Prettier formatter for frontend"
```

---

## Task 2: Add ts-prune for Dead Code Detection

**Files:**
- Modify: `frontend/package.json` (add ts-prune script)
- Modify: `backend/package.json` (add ts-prune script)

**Step 1: Install ts-prune in frontend**

```bash
cd /d/Projekte/TravStats/frontend && npm install --save-dev ts-prune
```

**Step 2: Add script to frontend/package.json**

Under `"scripts"`, add:
```json
"dead-code": "ts-prune | grep -v '(used in module)'"
```

**Step 3: Install ts-prune in backend**

```bash
cd /d/Projekte/TravStats/backend && npm install --save-dev ts-prune
```

**Step 4: Add script to backend/package.json**

Under `"scripts"`, add:
```json
"dead-code": "ts-prune | grep -v '(used in module)'"
```

**Step 5: Run ts-prune to baseline dead code**

```bash
cd /d/Projekte/TravStats/frontend && npm run dead-code 2>/dev/null | head -20
cd /d/Projekte/TravStats/backend && npm run dead-code 2>/dev/null | head -20
```

Expected: Some output listing potentially unused exports (informational)

**Step 6: Commit**

```bash
git add frontend/package.json backend/package.json
git commit -m "chore: add ts-prune dead code detection scripts"
```

---

## Task 3: Add Vitest Coverage Reporting

**Files:**
- Modify: `frontend/package.json` (add coverage script)
- Modify: `frontend/vite.config.ts` (add coverage provider config)

**Step 1: Install coverage provider**

```bash
cd /d/Projekte/TravStats/frontend && npm install --save-dev @vitest/coverage-v8
```

**Step 2: Add coverage script to frontend/package.json**

Under `"scripts"`, add:
```json
"test:coverage": "vitest run --coverage"
```

**Step 3: Update vite.config.ts to add coverage config**

In `frontend/vite.config.ts`, add inside the `test` object:
```typescript
coverage: {
  provider: "v8",
  reporter: ["text", "json", "html"],
  exclude: [
    "node_modules/**",
    "dist/**",
    "src/main.tsx",
    "**/*.d.ts",
    "**/*.config.*",
  ],
  thresholds: {
    global: {
      lines: 60,
      functions: 60,
      branches: 60,
    },
  },
},
```

**Step 4: Run coverage to verify**

```bash
cd /d/Projekte/TravStats/frontend && npm run test:coverage 2>&1 | tail -30
```

Expected: Coverage report printed, no crash

**Step 5: Commit**

```bash
git add frontend/package.json frontend/vite.config.ts
git commit -m "chore: add Vitest coverage reporting with v8 provider"
```

---

## Task 4: Add ruff.toml for Python Script Linting

**Files:**
- Create: `ruff.toml`
- Modify: `backend/package.json` (add lint:py script)

**Step 1: Create ruff.toml in repo root**

```toml
# ruff.toml - Python linter config
target-version = "py311"

[lint]
select = ["E", "W", "F", "I", "N", "UP", "B", "C4", "SIM"]
ignore = ["E501"]  # line-length handled by formatter

[lint.per-file-ignores]
"backend/src/scripts/*.py" = ["T201"]  # allow print() in scripts
```

**Step 2: Verify ruff is available (or install via pip)**

```bash
ruff --version 2>/dev/null || pip3 install ruff
```

Expected: ruff version printed or installation succeeds

**Step 3: Run ruff on Python scripts**

```bash
ruff check backend/src/scripts/ --select E,W,F 2>&1 | head -30
```

Expected: Some warnings or clean output

**Step 4: Fix any auto-fixable issues**

```bash
ruff check backend/src/scripts/ --fix 2>&1 | head -20
```

**Step 5: Add lint:py script to backend/package.json**

Under `"scripts"`, add:
```json
"lint:py": "ruff check backend/src/scripts/"
```

**Step 6: Commit**

```bash
git add ruff.toml backend/package.json backend/src/scripts/
git commit -m "chore: add ruff.toml Python linter config"
```

---

## Task 5: Add bandit.yml Security Config and LICENSE_WHITELIST.txt

**Files:**
- Create: `.bandit.yml`
- Create: `LICENSE_WHITELIST.txt`

**Step 1: Create .bandit.yml**

```yaml
# .bandit.yml - Python security linter config
skips:
  - B101  # assert statements (ok in scripts)
  - B603  # subprocess without shell=True (we use shell=False explicitly)
  - B607  # partial path in subprocess (python3 cmd is fine)
exclude_dirs:
  - node_modules
  - dist
  - .venv
```

**Step 2: Create LICENSE_WHITELIST.txt**

```
# Approved open source licenses for TravStats dependencies
MIT
Apache-2.0
Apache 2.0
ISC
BSD-2-Clause
BSD-3-Clause
0BSD
Unlicense
CC0-1.0
PSF-2.0
BlueOak-1.0.0
```

**Step 3: Commit**

```bash
git add .bandit.yml LICENSE_WHITELIST.txt
git commit -m "chore: add bandit security config and license whitelist"
```

---

## Task 6: Add Pre-commit Hooks

**Files:**
- Create: `.pre-commit-config.yaml`

**Step 1: Create .pre-commit-config.yaml**

```yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.5.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-json
      - id: check-merge-conflict
      - id: detect-private-key

  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.3.0
    hooks:
      - id: ruff
        args: [--fix]
        files: ^backend/src/scripts/.*\.py$

  - repo: local
    hooks:
      - id: prettier-frontend
        name: Prettier (frontend)
        language: node
        entry: bash -c "cd frontend && npx prettier --write"
        files: ^frontend/src/.*\.(ts|tsx|css)$
        pass_filenames: true
```

**Step 2: Install pre-commit (one-time)**

```bash
pip3 install pre-commit && pre-commit install
```

Expected: "pre-commit installed at .git/hooks/pre-commit"

**Step 3: Test hooks dry-run**

```bash
pre-commit run --all-files 2>&1 | tail -20
```

Expected: Hooks run, possible auto-fixes applied

**Step 4: Commit**

```bash
git add .pre-commit-config.yaml
git commit -m "chore: add pre-commit hooks for linting and formatting"
```

---

## Task 7: Add CI Workflow (GitHub Actions)

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Create .github/workflows/ci.yml**

```yaml
name: CI

on:
  push:
    branches: [Main, DEV]
  pull_request:
    branches: [Main]

jobs:
  backend:
    name: Backend (lint + typecheck + test)
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgis/postgis:15-3.4
        env:
          POSTGRES_DB: flights_test
          POSTGRES_USER: flights
          POSTGRES_PASSWORD: testpass
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
          cache-dependency-path: backend/package-lock.json

      - name: Install dependencies
        run: cd backend && npm ci

      - name: Type check
        run: cd backend && npx tsc --noEmit

      - name: Lint
        run: cd backend && npm run lint

      - name: Test
        run: cd backend && npm test -- --forceExit
        env:
          DATABASE_URL: postgresql://flights:testpass@localhost:5432/flights_test
          JWT_SECRET: ci-test-secret-min-32-chars-long!!

  frontend:
    name: Frontend (lint + typecheck + test + coverage)
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        run: cd frontend && npm ci

      - name: Type check
        run: cd frontend && npx tsc --noEmit

      - name: Lint
        run: cd frontend && npm run lint

      - name: Test with coverage
        run: cd frontend && npm run test:coverage

  python-lint:
    name: Python scripts (ruff + bandit)
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Install ruff and bandit
        run: pip3 install ruff bandit

      - name: Ruff lint
        run: ruff check backend/src/scripts/

      - name: Bandit security scan
        run: bandit -r backend/src/scripts/ -c .bandit.yml
```

**Step 2: Verify workflow syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML valid"
```

Expected: "YAML valid"

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions CI workflow"
```

---

## Task 8: Docker Security Hardening

**Files:**
- Modify: `docker-compose.prod.yml`

**Step 1: Read docker-compose.prod.yml**

File is at `docker-compose.prod.yml`. Current app/db services have no security opts.

**Step 2: Add to app service in docker-compose.prod.yml**

After the `networks` key inside `app`, add:
```yaml
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETUID
      - SETGID
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 1G
        reservations:
          cpus: "0.25"
          memory: 256M
```

**Step 3: Add to db service in docker-compose.prod.yml**

After the `networks` key inside `db`, add:
```yaml
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETUID
      - SETGID
      - FOWNER
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

**Step 4: Validate compose file**

```bash
docker compose -f docker-compose.prod.yml config > /dev/null && echo "Compose config valid"
```

Expected: "Compose config valid"

**Step 5: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "chore: Docker security hardening - cap_drop, no-new-privileges, resource limits"
```

---

## Task 9: Add Dev Setup Scripts

**Files:**
- Create: `scripts/setup-dev.sh`
- Create: `scripts/setup-dev.ps1`

**Step 1: Create scripts/setup-dev.sh**

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== TravStats Dev Setup ==="

command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js required"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker required"; exit 1; }

echo ">>> Installing backend dependencies..."
cd "$REPO_ROOT/backend" && npm ci

echo ">>> Installing frontend dependencies..."
cd "$REPO_ROOT/frontend" && npm ci

echo ">>> Generating Prisma client..."
cd "$REPO_ROOT/backend" && npx prisma generate

if command -v pre-commit >/dev/null 2>&1; then
  cd "$REPO_ROOT" && pre-commit install
  echo "    Pre-commit hooks installed."
else
  echo "    pre-commit not found - run: pip3 install pre-commit && pre-commit install"
fi

echo ""
echo "=== Setup complete! ==="
echo "Next: copy .env.example to .env, then docker compose up -d db"
```

**Step 2: Create scripts/setup-dev.ps1**

```powershell
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
```

**Step 3: Make shell script executable and test**

```bash
chmod +x scripts/setup-dev.sh
bash -n scripts/setup-dev.sh && echo "Script syntax OK"
```

Expected: "Script syntax OK"

**Step 4: Commit**

```bash
git add scripts/setup-dev.sh scripts/setup-dev.ps1
git commit -m "chore: add dev setup scripts for onboarding"
```

---

## Task 10: Add Smoke Tests

**Files:**
- Create: `scripts/smoke-test.sh`

**Step 1: Create scripts/smoke-test.sh**

```bash
#!/bin/bash
# Smoke test: verify a running TravStats instance is healthy
# Usage: ./scripts/smoke-test.sh [BASE_URL]
# Default: http://localhost:3000

set -e
BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0

check() {
  local desc="$1"
  local url="$2"
  local expected="${3:-200}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
  if [ "$status" = "$expected" ]; then
    echo "  PASS  $desc ($status)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $desc (expected $expected, got $status)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== TravStats Smoke Test: $BASE_URL ==="
check "Health endpoint"      "$BASE_URL/health"
check "Frontend loads"       "$BASE_URL/"
check "API 404 on base"      "$BASE_URL/api/v1" 404
check "Auth endpoint exists" "$BASE_URL/api/v1/auth/login" 405

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then echo "SMOKE TEST FAILED" >&2; exit 1; fi
echo "SMOKE TEST PASSED"
```

**Step 2: Make executable and syntax-check**

```bash
chmod +x scripts/smoke-test.sh
bash -n scripts/smoke-test.sh && echo "Script syntax OK"
```

Expected: "Script syntax OK"

**Step 3: Commit**

```bash
git add scripts/smoke-test.sh
git commit -m "chore: add smoke test script for post-deploy verification"
```

---

## Final Verification

After all 10 tasks, run:

```bash
# Type checks
cd /d/Projekte/TravStats/backend && npx tsc --noEmit && echo "Backend OK"
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && echo "Frontend OK"

# Frontend tests
cd /d/Projekte/TravStats/frontend && npx vitest --run && echo "Tests OK"

# Compose validation
docker compose -f docker-compose.prod.yml config > /dev/null && echo "Compose OK"

# Python lint (if ruff installed)
ruff check backend/src/scripts/ && echo "Python lint OK"
```

**Push to remote:**

```bash
git push
```
