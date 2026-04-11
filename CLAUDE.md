# TravStats

Flight tracker — Express/TypeScript backend + React/Vite/TypeScript frontend.

## Dev Commands

```bash
# Install everything
npm run install:all

# Run backend + frontend together
npm run dev           # alternative: scripts/dev-all.sh

# Run them separately
npm run dev:backend   # port 8000
npm run dev:frontend  # port 3000
```

## Deploy & Release Workflow

**No PRs.** Solo project — commits land directly on `main`. No branches,
no pull requests.

### `/deploy` — development iteration (daily)
Use the `deploy` skill. Runs fully automatically:
1. Analyses commits since the last version bump.
2. Auto-determines the bump type (`feat:` → minor, `fix:/chore:/…` →
   patch).
3. Drafts the changelog entry as prose.
4. Shows version + changelog draft → **one confirmation**.
5. Writes `backend/VERSION` + `CHANGELOG.md` and commits.
6. Builds the Docker image, pushes to GHCR, deploys to prod, health
   check and cleanup.

### `/release` — GitHub release (deliberate milestones)
Use the `release` skill. Aggregates every changelog entry since the
last GitHub release, creates a git tag, publishes a GitHub release
with `--latest`. No new deploy — the code is already running.

## Build Checks (MANDATORY before `/deploy`)

```bash
# Backend
cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit

# Frontend
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

## Docker & Deployment

Deployment details (server IP, SSH commands, compose paths) live in
**`CLAUDE.local.md`** (gitignored, created locally).

## Commit Requirement

**Every change must be committed before the session ends.**

## Architecture

```
backend/src/
  index.ts           # Express app entry
  routes/            # Route handlers — one file per domain
  middleware/        # auth, rateLimit, error
  services/          # Business logic
  schemas/           # Zod validation schemas
  utils/             # Helpers (logger, password, …)
  db.ts              # Prisma client singleton

frontend/src/
  pages/             # Route-level components
  components/        # Reusable UI components
  store/             # Zustand state stores
  lib/               # API client (api.ts), logger
  hooks/             # Custom React hooks
  i18n/              # react-i18next translations (de/en)
```

## Language Policy

- **Code, comments, commits, CHANGELOG, README, ADRs, runbooks — always
  English**, globally (see `~/.claude/rules/common/language.md`).
- **Frontend user-facing copy**: German primary, English secondary.
  When adding i18n strings, always update DE and EN together.

## Critical Gotchas

- **`any` is FORBIDDEN** — always use `unknown` + type guards. The only
  exception is `.d.ts` files.
- **Pino logger** — no `console.log`. Import:
  `import { logger } from '../utils/logger'`.
- **Prisma JSON fields** — cast via
  `as unknown as Prisma.InputJsonValue`, never directly from
  `Record<string, unknown>`.
- **deck.gl + MapLibre** — use the `MapboxOverlay` + `useControl`
  pattern (NOT the `<DeckGL>` React component — causes a WebGL
  conflict with MapLibre 5.x).
- **GeoJSON coordinates** — come from `geometry.coordinates`
  (LineString), NOT from `departureAirport.lat/lon` (which are
  unpopulated).
- **Auth cookie** — the JWT is an HttpOnly cookie (not a bearer
  token). Set `withCredentials: true` on every Axios instance.
- **Prisma migrations** — schema changes always via
  `npx prisma migrate dev` (never manually).
- **React hooks** — `useTranslation` is imported from
  `'../hooks/useTranslation'` (a project wrapper), not directly from
  `react-i18next`.
- **Zod** — mandatory for all user input and API requests. Schemas live
  in `backend/src/schemas/`.

## Code Style

- TypeScript: `strict: true`, ESLint + Prettier (printWidth 100,
  `singleQuote: false`).
- Async: always `async/await`, never `.then()`.
- Immutability: spread `{...obj, field: value}`, no in-place mutation.
- Error handling: explicit at every level, never swallow silently.
- File size: 200–400 lines ideal, **800 lines hard maximum**.

## Version

Source of truth: `backend/VERSION`.

Version bumps and changelog entries are managed by the `/deploy` skill
— do not edit them manually.

## Security

- Validate all user input via **Zod schemas** (system boundaries).
- Rate limiting on every auth and expensive endpoint
  (`express-rate-limit`).
- No hardcoded secrets — `.env` file (gitignored), in the container
  via a secrets volume.
- JWT in an HttpOnly cookie (never `localStorage`).
- XSS: React escapes automatically; no `dangerouslySetInnerHTML`.
- SQL injection: Prisma ORM (parameterised queries).
- Security scan: `scripts/security-scan.sh`.

Security findings: `PENTEST_FINDINGS.md` (when present).

## Testing

```bash
# Frontend (Vitest, no DB required)
cd frontend && npx vitest --run

# Backend (Jest, requires PostgreSQL)
cd backend && npm test -- --forceExit

# E2E (Playwright, requires a running dev server)
npx playwright test

# Everything at once
bash scripts/run-tests.sh   # alternative: scripts/run-tests.ps1
```

## Monitoring & Logs

- Logs in `data/logs/` (`app.log`, `error.log`, `http.log`,
  `parser*.log`).
- Pino structured JSON — the `LOG_LEVEL` env var controls verbosity.
- Health check: `GET /api/v1/health`.

## Machine-specific Info

→ See **`CLAUDE.local.md`** for: server IP (Underworld), SSH paths,
Docker Compose paths, local port mappings.
