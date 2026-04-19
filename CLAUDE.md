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

**No PRs.** Solo project — no pull-request ceremony. Branching strategy
is scoped to change size:

| Change size | Branch | When |
|---|---|---|
| Trivial (≤3 files, 1-line / config, no DB) | Direct commit to `main` | Typo, lint fix, tweak |
| Risky fix (multi-file, logic, migration, dep bump) | `fix/<slug>` off `main`, merge when green | Any bug fix with blast radius |
| Small feature | `feat/<slug>` off `main`, merge when done | Isolated enhancement |
| Large / long-running feature | `dev/<slug>` off `main`, NEVER commit to main until complete | Multi-phase work (e.g. `dev/multi-domain-v1` for cruise) |

**Rule of thumb:** if you'd want to be able to revert the change as a unit
or isolate it during review, branch it. Otherwise commit directly.

**`main` is the deploy trunk** — every commit on `main` is a candidate
for `/deploy`. Dev branches never deploy.

### Long-running feature branches (e.g. `dev/multi-domain-v1`)

When a `dev/<slug>` branch is active:

1. **Pull `main` into the dev branch after every main release.** Keep merges
   early + often so conflicts stay small:
   ```bash
   git checkout dev/multi-domain-v1
   git merge main
   ```
2. **Do NOT touch `backend/VERSION` or `CHANGELOG.md` on a dev branch** —
   both are owned by `/deploy` on main. Editing them on the branch creates
   guaranteed merge conflicts. `main → dev` merges carry them automatically.
3. **Do NOT `rebase main`** onto a long-running dev branch. Rebase rewrites
   history and breaks GitNexus, pre-commit hook caches, and any commit
   refs baked into memory / plan docs. Use `merge` every time.
4. **Final merge when the feature is ready:**
   ```bash
   git checkout dev/<slug>
   git merge main             # last sync
   # run full tsc + tests + manual smoke
   git checkout main
   git merge --no-ff dev/<slug>   # explicit merge commit — no fast-forward
   /deploy
   ```

### Short-lived fix/feat branch workflow

```bash
git checkout main
git checkout -b fix/<slug>
# … edit, commit …
git checkout main
git merge fix/<slug>         # fast-forward is fine
git branch -d fix/<slug>
/deploy
```

### RC-first rule (every release, no exceptions)

Every release — major, minor, patch, security fix, beta bump — starts
as a **Release Candidate**:

1. `/deploy` builds `:X.Y.Z-rc.N` (or `:X.Y.Z-security-rc.N`, etc.),
   pushes to GHCR, deploys that RC tag to Underworld.
2. Same RC also gets a **git tag** (`v<RC_TAG>`) and a **GitHub
   Pre-release** (`--prerelease`, never `--latest`) — so every RC is
   visible in all three places (GHCR tag, git tag, GH Releases list).
3. The RC runs on prod and gets verified (health check + user UAT).
4. **Only on the user's explicit promotion command** (e.g. "promote",
   "mach den echten Release", "final") are the final tags
   `:X.Y.Z` / `:latest` / `:stable` cut via `docker buildx imagetools
   create` — byte-identical retag, no rebuild.
5. Docker Hub mirror and `/release` (final GitHub Release with
   `--latest`) only after promotion.

No final tag ever comes from a fresh build. No release happens without
an explicit manual command from the user.

### `/deploy` — builds an RC
Use the `deploy` skill. Runs fully automatically up to the RC deploy:
1. Analyses commits since the last version bump.
2. Auto-determines the bump type (`feat:` → minor, `fix:/chore:/…` →
   patch).
3. Drafts the changelog entry as prose.
4. Shows version + changelog draft → **one confirmation**.
5. Writes `backend/VERSION` + `CHANGELOG.md` and commits.
6. Builds the RC Docker image, pushes to GHCR, deploys the RC tag to
   prod, health check and cleanup. Stops and waits for promotion.

### `/release` — GitHub release (after promotion only)
Use the `release` skill. Requires the final tags (`:X.Y.Z` / `:latest`
/ `:stable`) to already exist on GHCR from a prior promotion — the
skill refuses to run otherwise. Aggregates every changelog entry since
the last GitHub release, creates a git tag, publishes a GitHub release
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

- **NEVER run `taskkill`** — do not kill processes (`node.exe` or
  any other). If a port is busy, ask the user to handle it.
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
- No hardcoded secrets — `.env` file (gitignored) for the few required
  env vars; JWT/encryption keys are auto-generated on first boot and
  persisted to `/app/data/secrets/` (a subdir of the single data volume).
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
