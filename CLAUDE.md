# TravStats

Self-hosted travel logbook (flights, cruises, more) — Express/TypeScript backend + React/Vite/TypeScript frontend.

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
| Trivial (≤3 files, docs/tooling, no app logic, no DB) | Direct commit to `main` — only with the owner's explicit OK | Typo, lint fix, doc tweak |
| Risky fix (multi-file, logic, migration, dep bump) | `fix/<slug>` off `main` | Any bug fix with blast radius |
| Small feature | `feat/<slug>` off `main` | Isolated enhancement |
| Large / long-running feature | `dev/<slug>` off `main`, NEVER commit to main until complete | Multi-phase work (e.g. `dev/multi-domain-v1` for cruise) |

**Rule of thumb:** develop on a branch. `main` mirrors what is (about to be)
released, so landing anything there is a product decision, not a workflow step.

**`main` is the deploy trunk** — every commit on `main` is a candidate
for `/deploy`. Dev branches never deploy.

> **Merging into `main` is the owner's RELEASE decision.** A branch being
> green, reviewed and complete says nothing about whether it should ship.
> When a branch is done: report it, then ask as a **single, isolated
> question** whether to merge — never bundled into a list of next steps
> where a general "ja" could be mistaken for release consent.

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

> **Full pipeline + staging:** see **`docs/RELEASE_WORKFLOW.md`**. Since
> 2026-07-04 the RC lands on the **RC Server** (CT106, a prod-DATA mirror)
> FIRST — cloned via `scripts/stage-rc-from-prod.sh` — and only then on prod.
> "RC Server" is the renamed role of the former beta server (host unchanged).

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
7. **Announce the RC in Discord** — after the RC is live, post to
   `#beta-channel`:
   ```bash
   cd tools/discord-setup && npm run announce rc <RC_TAG>   # e.g. 2.3.0-rc.1
   ```
   Reads the matching `CHANGELOG.md` entry automatically (the `-rc.N`
   suffix is stripped for the lookup). Needs `tools/discord-setup/.env`
   (bot token + guild id) — see `tools/discord-setup/README.md`.

### `/release` — GitHub release (after promotion only)
Use the `release` skill. Requires the final tags (`:X.Y.Z` / `:latest`
/ `:stable`) to already exist on GHCR from a prior promotion — the
skill refuses to run otherwise. Aggregates every changelog entry since
the last GitHub release, creates a git tag, publishes a GitHub release
with `--latest`. No new deploy — the code is already running.
After the GitHub release is published, **announce it in Discord** — post
to `#announcements`:
```bash
cd tools/discord-setup && npm run announce release <X.Y.Z>   # e.g. 2.3.0
```

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
- **Pino logger** — no `console.log`. `utils/logger.ts` exports the logger as a
  **default** export, so import it as
  `import logger from '../utils/logger'` (there is no named `logger` export;
  the named exports are the category loggers like `httpLogger`, `parserLogger`).
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
- **Beta gating (since 2.4.0)** — unfinished features must register in
  `frontend/src/config/betaFeatures.ts` and hide behind
  `betaFeaturesEnabled` (admin_settings column, default `false`). Currently
  gated: POI dashboard tab, Devices settings entry, trip AI summary. The
  Devices entry is the ONLY phone-pairing entry point — it must be
  un-gated when the mobile app ships. The flag is instance state: never
  persist it client-side (see the `partialize` in `settingsStore.ts`).
- **Map colour modes (since 2.4.0)** — flight and cruise colouring are
  explicit modes (`lib/flightColor.ts`, `lib/cruiseColor.ts` + their
  Zustand stores). Layers AND the legend must resolve colours through
  these stores — never hardcode an arc colour or legend swatch, and never
  let a view/tab decide the mode implicitly. That implicit override is
  exactly the bug 2.4.0 removed.
- **Domain gating** — every new page/feature must check
  `useEnabledDomains()` on the frontend; every new parser-target must register
  in `backend/src/shared/domains.ts` and its frontend mirror at
  `frontend/src/shared/domains.ts`. Shared code paths iterate
  `AVAILABLE_DOMAINS`, never `enabledDomains.includes('flight')`.
- **Cruise stops (3-state invariant)** — each stop is exactly one of:
  (1) **matched port** — `portId` set, `isAtSea = false`,
  `unresolvedPortName = null`; (2) **sea day** — `isAtSea = true`,
  `portId = null`, `unresolvedPortName = null`; (3) **unresolved port** —
  `portId = null`, `isAtSea = false`, `unresolvedPortName` non-empty (an
  imported port that couldn't be matched to the catalog; the name is
  preserved, the stop stays a port call, the user resolves it later). Zod
  (`schemas/cruise.ts`) rejects any other combination. An unresolved stop
  counts as a port call (`totalPortCalls`, frontend `countUniquePorts`) but
  is coordinate-less, so it's excluded from legs/distance/map. The stops
  editor must renumber `dayNumber` as `index + 1` after add/remove/reorder,
  and clear `unresolvedPortName` whenever a stop becomes a matched port or a
  sea day.
- **Dashboard is multi-domain** — `frontend/src/pages/DashboardPage.tsx` is a thin shell delegating to per-tab components under `frontend/src/components/Dashboard/tabs/`. Tab modes are domain-scoped via `frontend/src/types/dashboard.ts` (no more global `VisMode` union). URL carries tab + mode (`/dashboard/<tab>?mode=<mode>`); `localStorage` remembers the last mode per domain. `MapContainer3D` uses a private `MapMode = "routes" | "heatmap" | "trips" | "globe"` internally; retired modes `hexagon`, `contour`, `columns`, `trip-routes` are gone. Flight-only modes are opt-in via `showInternalCruises={false}` on FlightsTab.
- **Cruise sea-routes** — `backend/src/services/schematicRouter.ts` runs
  the schematic pipeline (coarse 1° A* water path → Douglas-Peucker
  simplification to 3–8 waypoints; raw port coords are always the
  first/last waypoint; if A* fails on a truly disconnected sea it returns
  a straight `[dep, arr]` chord). This **replaced** the old Hybrid-v2 A*
  pipeline (`seaRouter.ts`, removed) — the route-cache table was dropped
  too (migration `20260425200000_drop_cruise_route_cache`; no more
  `CruiseRouteCache` / `CACHE_VERSION`). The frontend fetches the
  waypoints per leg via `GET /api/v1/cruises/:id/geometry` and runs a
  Catmull-Rom spline through them; the dashboard Cruises tab consumes
  this via `MapContainer3D`. When the backend returns no geometry for a
  leg, `buildCruiseArcs` (`frontend/src/components/layers/cruiseArcsLayer.ts`)
  falls back to a straight chord `[[a.lon,a.lat],[b.lon,b.lat]]` — there
  is no `buildCruiseArc` Bezier helper anymore. Prototype iteration for
  routing algorithms lives in `tools/sea-route-lab/` — not wired into the
  app, browser-only.
- **Marnet shipping-lane router is in-house** — the abandoned
  `searoute-ts` npm package was dropped on 2026-04-30 (its extensionless
  ESM imports broke silently on Node ≥ 22, so every cruise leg was
  falling through to the coarse 1° fallback for weeks). The vendored
  Eurostat marnet GeoJSON now lives at `backend/data/marnet/marnet.geojson`
  and is loaded by `services/marnet/marnetGraph.ts` (graph + A*). The
  high-level entry point is `routeMarnet()` in `services/marnet/marnetRouter.ts`.
  Both `services/schematicRouter.ts` and `services/cruiseDistance/marnetCalculator.ts`
  consume it. The Dockerfile copies `backend/data/marnet/marnet.geojson`
  into the production image alongside the land mask — without it the
  router throws ENOENT on first cruise request.
- **Ship + Port seeds are idempotent** — `seedShipsFromCSV` /
  `seedPortsFromCSV` skip rows whose `imo` / `unlocode` already exists.
  User-added rows (`isUserAdded=true`) are never overwritten by
  re-seeding. Seed test suites wipe ALL rows in `beforeEach` and re-seed
  in `afterAll` to keep the dev DB in a predictable populated state.
- **Airline logos (chain since 2.5.0)** — `resolveAirlineLogo`
  (`backend/src/services/airlineLogo/airlineLogoService.ts`) resolves a code+variant
  through four tiers, each returning `null` on a miss so it falls through (a tier
  must NEVER return a placeholder — that invariant the whole chain rests on):
  **logostream** (premium, only where an admin key is configured) → **vendored**
  (`vendoredLogos.ts`, the ICON tier: serves ONLY `icon` + `logo-white`→`icon-mono.svg`,
  no wordmarks) → **kiwi** (`images.kiwi.com`, the keyless default for wordmark-shaped
  variants — a finished 128px SQUARE brand tile that carries its own background;
  IATA-only, unknown codes return a byte-stable grey-aeroplane placeholder guarded by
  md5) → **Daisycon** (tail net). The frontend renders the tile **BARE**
  (`AirlineWordmarkCell.tsx`): there is no manifest endpoint, no brand-colour map and
  no `isDark` luminance plate any more — all three were DELETED because painting a
  plate behind a tile that already has its own background shipped an INVISIBLE logo in
  2.5.0-beta.1 (and every unit test passed while it was invisible — so changes here get
  a browser look, not just green tests). The disk cache (`logoCache.ts`,
  `getCachedLogoEntry`) is stale-while-revalidate: it always serves cached bytes and
  kicks a background refresh when stale, coalesced per key. Entries carry
  `fetchedAt`/`lastAttemptAt`/`source`; a FAILED refresh writes only `lastAttemptAt`
  (never `fetchedAt`), so a stale entry stays visibly stale for the next retry instead
  of freezing forever. A nightly cron sweep (`jobs/airlineLogoRefreshScheduler.ts`,
  3 AM UTC) plus an admin re-sync (`POST /admin/airline-logos/refresh`) keep stored
  logos current.
- **Cruise migrations (historical note — the drift is GONE)** — the initial
  cruise migration (`20260419120000_cruise_module`) and its fixups
  (`20260419130000_cruise_fixups`) were hand-written rather than
  `prisma migrate dev`-generated, because schema.prisma had drift vs. the
  migration history (NOT-NULL flips on `flights.has_live_tracking` +
  `user_settings.historical_enrichment_*`, plus DROP INDEX reconciliations)
  that `prisma migrate dev` would have bundled into any new migration.
  **Re-measured 2026-08-01: that drift no longer exists.**
  `prisma migrate diff --from-migrations prisma/migrations
  --to-schema-datamodel prisma/schema.prisma --script` reports an empty
  migration, so `prisma migrate dev` is usable normally again and new
  migrations do NOT need hand-writing. Re-run that diff before assuming
  otherwise — this note claimed the opposite for months after it stopped
  being true and cost a design decision.
- **Cruise parser is live** —
  `backend/src/services/cruiseBookingParser.ts` implements the full
  AIDA / TUI / generic-LLM extraction pipeline. It is wired into
  `routes/emailParse.ts` + `routes/pdfParse.ts` (both branch on
  `parsed.domain === 'cruise'` and call `parseCruiseBookingText` →
  `resolveCruiseEntities`). Sample booking emails for regression
  tests live under `test-samples/Kreuzfahrt-emails/`.
- **Immich albums** — a trip links Immich albums in one of two modes.
  **Link mode** stores zero bytes: images stream through an ownership- and
  membership-checked proxy (`routes/immich/assetProxy.ts`) with browser ETag
  caching. **Import mode** downloads originals into `getTripPhotoDir()` as
  ordinary `TripPhoto` rows, idempotent via the `(tripId, immichAssetId)` unique
  index. Three things that look wrong but are deliberate:
  (1) `POST /resync` checks `isImportInFlight(linkId)` and resolves the
  connection **before** resetting the job row to `pending` — reversing that order
  clobbers a live `running` job and then strands it forever, because
  `startAlbumImport` refuses an in-flight link.
  (2) An ENV-provided connection counts as **shared** (`isShared = source !== "user"`),
  deliberately diverging from `apiKeyResolver.hasApiKeyAccess`.
  (3) `normalizeImmichBaseUrl` has **no egress restriction** on purpose — a
  self-hosted Immich lives on the LAN, so a private-IP block would break the
  primary use case. Instances that expose Immich configuration to untrusted users
  must restrict it at the deployment layer.
  Every Immich error body uses the fixed kind vocabulary
  (`notConfigured|unreachable|auth|notFound|protocol|invalidUrl`) that the
  frontend's `immichFailureKind()` parses — prose in `{error: …}` silently
  degrades to a generic toast. `invalidUrl` (a rejected/malformed base URL, the
  user's own typo) is deliberately distinct from `protocol` (Immich answered but
  the payload/version was unexpected) so a URL typo does not send the user
  debugging their server version.

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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **TravStats** (5787 symbols, 14746 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/TravStats/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/TravStats/context` | Codebase overview, check index freshness |
| `gitnexus://repo/TravStats/clusters` | All functional areas |
| `gitnexus://repo/TravStats/processes` | All execution flows |
| `gitnexus://repo/TravStats/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

---

## Git-Remotes — Forgejo und GitHub (seit 2026-08-01)

Dieses Repository hat **zwei Remotes**:

| Remote | Ziel | Rolle |
|--------|------|-------|
| `origin` | GitHub | Massgeblich fuer Oeffentliches — PRs, Actions, Dependabot, GHCR |
| `forgejo` | `ssh://git@192.168.178.254:2222/dennis/TravStats.git` | Private Vollsicherung im Haus, inkl. aller lokalen Branches |

**Regel beim Pushen:**

```bash
git push origin <branch>    # oeffentlich, wie bisher
git push forgejo --all      # zusaetzlich IMMER - alle lokalen Branches
git push forgejo --tags
```

Der zweite Befehl ist der entscheidende. Am 1. August 2026 existierten
15 Branches ueber vier Repositories ausschliesslich lokal, obwohl alle ein
GitHub-Remote hatten.

**Dateien, die `.gitignore` hier ausschliesst** (`CLAUDE.md`, `AGENTS.md`,
Roadmaps, Pentest-Notizen), liegen im Begleitrepo **`TravStats-local`** auf
Forgejo. Git kennt keine Ignore-Regeln pro Remote, deshalb der Umweg.

**Secrets gehoeren in keines von beiden** — dafuer ist Infisical zustaendig
(CT 141, `192.168.178.145`).

Vollstaendiges Konzept: `D:\Projekte\CC\docs\git-konzept.md`
