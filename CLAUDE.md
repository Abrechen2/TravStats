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

# Repo-level checks (file-size ratchet + Prisma schema drift).
# check:drift needs a reachable Postgres and does not read backend/.env.
DATABASE_URL="postgresql://…" npm run check
```

This list is the real gate. CI (`ci.yml`, since 2026-08-30) runs the first
two lines of it on every push and PR — typecheck and lint in both trees, and
Vitest — plus Prettier on changed frontend files. The backend Jest job is
there too but **advisory** (`continue-on-error`, for three named reasons in
the workflow's comment block), and nothing in CI runs `npm run check`. So a
green badge covers the frontend and the static half of the backend; the
backend suite and the repo-level checks are still yours to run. See
**Rules** below for what is machine-enforced and what is not.

## Docker & Deployment

Deployment details (server IP, SSH commands, compose paths) live in
**`CLAUDE.local.md`** (gitignored, created locally).

## Where a finding goes — issue or board item

This repository is public. A GitHub issue is therefore a **published statement**,
and the tracker is what a stranger reads to judge whether the project is alive
and honest. That makes the tracker worth keeping signal-only.

The deciding question is **not** who found it. It is:

> Does a person running TravStats need to know this?

| Finding | Where |
|---|---|
| Anything a user can hit, see, or must act on — a wrong number on screen, data at risk, a broken import | **GitHub issue**, however it was found. Owner, tester, or a routine prod check makes no difference. |
| The same thing, but the write-up quotes internal paths, host names, sample data or measurement runs | **Forgejo issue** on `dennis/TravStats`. Same finding, private write-up — see below. |
| Internal engineering and tooling — our own scripts, test-suite noise, log hygiene with no user-visible effect, chores like wiring a check into CI | **Leitstand item**, no issue anywhere |
| Exploitable **and** still open | **GitHub private security advisory** (draft), never a public issue; publish it once the fix ships |
| Infrastructure, hosts, scope decisions, pentest notes | stays out of all three — `CLAUDE.local.md`, `ROADMAP.local.md`, `TravStats-local` on Forgejo |

An internal finding becomes an item in `roadmap.local.yaml` with
`source: { type: audit }` (found by a sweep) or `{ type: owner }` (a decision or
a wish). Those carry a **title**, because they have no live anchor to read one
from — the schema enforces it, and it enforces the mirror rule too: a `github`
or `forgejo` item must NOT carry a title, since its title is read live.

### Three trackers, and the two rules that make that safe

Forgejo issues were once ruled out here, for two reasons that were correct and
have both now been answered rather than argued away.

**Reference collisions — solved by convention.** The numbering spaces are
independent, and they have already collided: GitHub `#36` is a zod dependency
bump, Forgejo `#36` is the boarding-pass OCR bug. Since 2026-09-01 there is a
third space — the Companion keeps its own Forgejo tracker on
`dennis/TravStatsCompanion`, which started at `#1` and will therefore collide
with both of the others within the month. So:

> | Written | Means |
> |---|---|
> | `#36` | GitHub, `Abrechen2/TravStats` |
> | `forgejo#36` | Forgejo, `dennis/TravStats` |
> | `companion#3` | Forgejo, `dennis/TravStatsCompanion` |

Three rules hold that together, and each exists because of a specific way it
would otherwise fail:

1. **Never write a bare number for anything but GitHub**, even where the
   surrounding text makes it obvious. It will not be obvious in `git log` two
   years from now, and GitHub will happily render it as a link to the wrong
   thing.
2. **A reference means the same thing in every repository it is read in.**
   `forgejo#42` is `dennis/TravStats` issue 42 *including when written inside
   the Companion repo* — even though that repo's own `origin` is also Forgejo,
   which is exactly the reading that would go wrong. Likewise `companion#3` is
   the Companion's issue 3 including inside the Companion itself. A prefix that
   depended on where you were standing would be no prefix at all.
3. **`companion#N` is the Forgejo tracker, and stays reserved for it.** The
   Companion also has a GitHub remote, deliberately unused (the standing rule
   is Forgejo-only). If that tracker is ever opened, it needs a form of its own;
   it must not inherit the bare `#N`, which is spoken for.

Cross-repository references are normal here and should be written in full where
prose allows — "`dennis/TravStats` forgejo#42" costs four words and survives
being quoted into an issue body, a changelog, or a chat log with no repository
around it.

**Board blindness — solved in the tool.** The objection that the Leitstand
could only measure `github` items live, and would have to hand-copy the state
of anything else, was true until 2026-08-30. It now has a `forgejo` source type
that reads titles and open/closed state through the `tea` CLI, exactly as the
`github` one shells out to `gh`, including the unassigned column. Configure it
with a `forgejo:` block in `roadmap.local.yaml`.

So: `source: { type: forgejo, ref: 36 }` is a first-class board item, carries no
title, and is measured live. A finding the board cannot see is a finding nobody
is measuring — that was the real objection, and it no longer applies.

**Which tracker.** GitHub is the published statement: it is what a stranger
reads to judge whether the project is alive and honest, so it stays signal-only
and free of internal detail. Forgejo is where the same finding can name a path
under `~/projekte`, a container on `192.168.178.x`, or a passenger name off a
test boarding pass. When a finding needs both, the GitHub issue is the short
public one and links nowhere internal; the Forgejo issue carries the evidence.

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
- **Frontend user-facing copy**: German primary, English secondary. DE and EN
  move together — enforced by `frontend/src/i18n/__tests__/localeKeyParity.test.ts`,
  because a missing key is silent: react-i18next renders the key itself, so a
  German string added without its mirror ships `tours.leg.mode.ferry` as copy.

## Critical Gotchas

These are design invariants — facts about how this code is wired, not rules.
The rules, and which of them a machine actually holds, are in **Rules —
enforced, and merely practised** below.

- **NEVER run `taskkill`** — do not kill processes (`node.exe` or
  any other). If a port is busy, ask the user to handle it.
- **Pino logger** — `utils/logger.ts` exports the logger as a **default**
  export, so import it as `import logger from '../utils/logger'` (there is no
  named `logger` export; the named exports are the category loggers like
  `httpLogger`, `parserLogger`).
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
  `npx prisma migrate dev` (never manually), and `npm run check:drift` must
  stay green.
- **React hooks** — `useTranslation` is imported from
  `'../hooks/useTranslation'` (a project wrapper), not directly from
  `react-i18next`.
- **Beta gating (since 2.4.0)** — unfinished features register in
  `frontend/src/config/betaFeatures.ts` and hide behind `betaFeaturesEnabled`
  (admin_settings column, default `false`). **That registry is the list — do
  not restate it here**; a list in prose beside a list in code is a list that
  is wrong. Each entry carries `why` it is hidden and `returnsWhen` it may
  come back, and a test fails when either is missing. Un-gating means deleting
  the entry AND every `isFeatureVisible` call it named — a gate left wired to a
  key that no longer exists reads like a gate that is still there. Two standing
  notes: the flag is instance state, never persisted client-side (see the
  `partialize` in `settingsStore.ts`); and the whole point of `returnsWhen` is
  that it is acted on — on 2026-09-01 `devicePairing`, `tourRoutes` and
  `dawarich` came off together, the first because the phone app it named
  (TravStatsCompanion, not the abandoned TravStatsApp the entry still said)
  had shipped while the gate hid the only place a claim code is minted, and
  the last because releasing tour routes WAS the event its own `returnsWhen`
  was waiting for. And on 2026-09-05, reading the 2.6.0 announcement that
  called them "out of beta", the owner ruled all three beta and put them back
  behind the switch (2.6.0 was re-cut) — a `returnsWhen` that has come true is a reason
  to ask, not a licence to ship.
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
- **Schema drift** — the two cruise migrations (`20260419120000_cruise_module`,
  `20260419130000_cruise_fixups`) were hand-written because schema.prisma had
  drift that `prisma migrate dev` would have bundled into any new migration.
  That is over; `prisma migrate dev` is normal again. This paragraph used to
  carry the measurement, and claimed the opposite for months after it stopped
  being true — which cost a design decision. `npm run check:drift` answers it
  now, so ask the check, not the doc.
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
- **Two-factor and passkeys are two DIFFERENT trades** — read this before
  touching either. TOTP (`routes/auth/twoFactor.ts`) is a second factor *on top
  of* the password: the login handler answers a correct password with
  `{requiresTwoFactor: true}` plus a `twofa_token` cookie. That branch must stay
  **ABOVE** the `mustChangePassword` branch in `routes/auth.ts` — an account with
  both flags would otherwise get a `change_token` on the password alone, and
  `force-change-password` consumes only that cookie, which is a full account
  takeover. A test pins the ordering; do not "tidy" it.
  A passkey (`routes/auth/passkeys.ts`) is the opposite trade: it *replaces* the
  password AND satisfies two-factor by itself, so `login/verify` issues the
  session directly and never consults `twoFactorEnabledAt`. That is only sound
  because both ceremonies demand `userVerification: "required"` and pass
  `requireUserVerification: true` — the assertion proves possession *plus* a
  local gesture. **Relaxing that to `"preferred"` silently converts the passkey
  route into a 2FA bypass.** Sign-in is username-less on purpose (no
  `allowCredentials`), which is what lets a syncing password manager offer its
  discoverable credential. A credential is bound to ONE rpId forever, so the
  rpId is an explicit admin setting and never guessed from the `Host` header;
  origins are a list because several may share one rpId, but a bare IP is not a
  valid rpId and plain http outside localhost is not a secure context at all —
  `passkeyUnavailableReason()` says which, and the UI explains instead of
  drawing a button that always fails. The passkey login button ALSO checks
  `window.isSecureContext` — the server only knows its configured origins, so an
  instance reached over plain-http LAN would otherwise show a button the browser
  can never honour (found in beta UAT).
- **Every `/api` response is `Cache-Control: no-store` by default** — one
  middleware in `index.ts`, mounted above the health route. This is a security
  boundary, not a perf tweak: beta UAT caught Cloudflare caching an
  authenticated per-user GET (`/auth/passkeys`) in a shared edge cache and
  serving it across sessions. Authenticated API responses carry no other
  cache-control, so without this default a CDN or proxy is free to cross-serve
  private data. Handlers that legitimately cache (airline logos, the Immich
  asset proxy) set `Cache-Control: private, max-age=…` themselves and override
  the default — `private` also keeps them out of shared caches. Never add a
  blanket cacheable header to `/api`, and if a new endpoint must cache, use
  `private`, never `public`.
- **express-rate-limit 8 reads your `keyGenerator`'s source** (since
  2026-09-06, #294). It calls `toString()` on the function and, if it finds
  `req.ip` without `ipKeyGenerator`, logs `ERR_ERL_KEY_GEN_IPV6` through
  `console.error` once per limiter — at BUILD time, not per request, so a
  boot prints twenty-odd error lines and the suite stays green. The
  complaint is right: one IPv6 host owns far more than one address, so a raw
  `req.ip` key hands it a fresh bucket per request. `userOrIpKey` in
  `middleware/rateLimit.ts` masks to /56 via `ipKeyGenerator`;
  `rateLimit.ipv6.test.ts` checks the silent boot and the shared bucket. A
  new limiter with its own key function must do the same.

## Rules — enforced, and merely practised

The split is the point. An **enforced** rule has a named check that fails; a
**practised** one holds only while someone remembers it. Do not move a rule
into the first list without naming its check, and do not read the second list
as decoration — it is where the properties worth the most currently live.

The gap is a tooling one, not a discipline one, and it is measurable: the
`any` ban has three violations in this tree and all three are the word "any"
in an English sentence, while the 800-line limit — stated for just as long,
checked by nothing until now — is broken by 21 files, the largest at 2161.

### Enforced

| Rule | Check |
|---|---|
| `any` is forbidden — **frontend only** | `@typescript-eslint/no-explicit-any` (error, via `tseslint.configs.recommended`) + `eslint . --max-warnings 0`. The backend sets it to `'warn'` and runs bare `eslint src`, so a backend `any` passes. `.d.ts` is exempt on purpose. |
| No unused variables (`^_` opts out) | same two eslint configs — error on the frontend, warn on the backend |
| Frontend formatting | `prettier --check` on changed files (`.github/workflows/ci.yml`) plus a `prettier --write` pre-commit hook |
| DE and EN move together | `frontend/src/i18n/__tests__/localeKeyParity.test.ts` — reads the namespace list from the filesystem, so a new namespace is covered the day it is added, and keeps no allow-list |
| No source file over 800 lines | `scripts/check-file-size.mjs` (`npm run check:size`) |
| `schema.prisma` agrees with `prisma/migrations` | `backend/scripts/check-schema-drift.ts` (`npm run check:drift`, root or backend) — replays the migrations into a shadow DB (`--from-migrations`), so the answer does not depend on which branch your dev database last saw |
| Every served endpoint appears in the OpenAPI spec | `backend/src/__tests__/openapi.coverage.test.ts` vs `services/openapi/pending.ts` |
| Every documented 200 carries a JSON schema | `backend/src/__tests__/openapi.responseSchema.test.ts` vs `openapi.responseSchema.baseline.json` |
| Every beta gate key is registered, with a reason and an un-gating condition | `frontend/src/__tests__/config/betaFeatures.test.ts` — source-scans for `isFeatureVisible("…")` |
| `/api` answers `no-store` unless a handler opts into `private` | `backend/src/__tests__/apiNoStore.test.ts` |
| 2FA is asked before a forced password change | `backend/src/routes/__tests__/twoFactor.login.test.ts` — "asks for the second factor even when a password change is also due" |
| No private key, no conflict marker, no >15 MB blob in a commit | `.pre-commit-config.yaml` |
| A router answers in ONE response shape — bare or `{success, data}` — per `docs/adr/0001-api-response-shape.md` | `backend/src/__tests__/apiResponseShape.ratchet.test.ts` vs `apiResponseShape.baseline.json` — a new router file must be assigned a family; a bare-family router gains no envelope; the twelve frozen leaks only shrink |

Four of these are **ratchets** carrying a list of today's offenders — file
size, OpenAPI coverage, OpenAPI response schemas, response-shape leaks. Each
fails on a *stale* entry as well as a new one, so the list can only ever
shrink.

**Where they run.** The pre-commit hooks and two workflows are automatic.
`ci.yml` (2026-08-30) runs typecheck + lint for both trees, Vitest, and
Prettier on changed frontend files as required jobs, and the backend Jest
suite as an advisory one — it is allowed to fail, and its comment block names
the three things that must be fixed before that changes. `security.yml` runs
`npm audit` on production deps, Trivy and CodeQL on every push to `main` and
weekly. CodeQL has been red on every run since it landed — not a finding,
a rejection: "CodeQL analyses from advanced configurations cannot be
processed when the default setup is enabled". The repository has GitHub's
default code-scanning setup switched on, and that refuses the SARIF our own
job uploads. One of the two has to go (repo settings, owner's call), and
until then the red Security badge says nothing. None of the four ratchets, `check:size` or `check:drift` run
in CI (forgejo#60); the drift script has said so since 2026-09-01, and the
two plan docs that called it "CI-guarded" were corrected on 2026-09-04. This
paragraph itself claimed "only Prettier" for a week after `ci.yml` landed —
corrected 2026-09-06.

**One drift script, since 2026-09-01.** There were two, and they disagreed:
`scripts/check-schema-drift.mjs` at the root replayed the migrations into a
shadow DB, while `backend/scripts/check-schema-drift.ts` compared against the
connected database because `--from-migrations` reported postgis as false
drift under the `postgresqlExtensions` preview feature. That feature left
`schema.prisma`, the objection expired with it, and `e24c9a57` (forgejo#74)
deleted the root script and moved the backend one onto `--from-migrations`.
`npm run check:drift` at the root delegates to it. A postgis diff, should
one ever appear again, is the feature coming back — not noise.

**The 800-line number is ratified** (owner, 2026-09-05). What was settled
first is the shape: a limit, a frozen baseline, and a list that only shrinks.
`check-file-size.mjs` scans `backend/src` and `frontend/src` (tests and seed
scripts excluded); 21 files already exceed 800 and are frozen at their
current size in `scripts/file-size-baseline.json`, the largest at 2161. A
listed file may shrink, may never grow, and must leave the list at 800 or
below — `--update` refuses to raise an entry. The number was provisional for
four days — it was what CLAUDE.md happened to say — and was confirmed as the
rule on 2026-09-05 together with the design-system decisions in
`ClaudeDesign/handoff/2026-09-05-web-redesign-rueckmeldung.md` §9.

### Practised, not enforced

Nothing fails when these break. They are also the candidate list for the next
check.

- **Abstention is a result.** A value that cannot be derived is null or
  absent, never zero. `shared/flightDuration.ts` states it: "`null`, not 0 — a
  zero would silently drag every average down, which is the bug this file
  exists to end". `utils/continents.ts` returns null for a transcontinental
  country with no coordinates rather than putting Vladivostok in Europe.
  `services/punctualityStats.ts` keeps "no delay recorded" (null, out of the
  sample) apart from "on time" (inside a 15-minute grace band) and names no
  best/worst airline under three flights. `shared/lodgingTiming.ts` carries
  `nightsKnown` because a same-day stay and an unknown span are both 0, "and
  an average over the second is a lie". `routes/stats.ts` names the
  anti-pattern it removed: a year-over-year delta on a lifetime set, "a
  comparison that could not exist, presented as data".
- **A counting rule has exactly one home.** `shared/lodgingCounting.ts` owns
  "does this stay count" (owner rule: not until check-out is past),
  `shared/placeCounting.ts` the same for places, and
  `shared/statusDerivation.ts` / `shared/flightDuration.ts` /
  `utils/continents.ts` their own questions. `continents.ts` exists because
  two byte-identical copies "carried a 'keep both in sync' comment and had
  already drifted". Most are mirrored backend↔frontend with a "change both
  together" header, and **nothing checks the mirrors** — each side has its own
  test asserting the same truth table, which is a convention, not a guard.
  `shared/flightCounting.ts` is the same move for flights; it lives on
  `refactor/flight-counting-predicate` and is not merged, so
  `status === 'flown' || status === 'historical'` is still inlined here.
- **Comments justify, they do not describe.** The good ones name the defect
  that appeared when the code was the other way, and what it measured:
  `airportLookup.ts` on merge precedence ("measured at 242 of 878 airport
  references on a real account … the worst 1.6 km out"); `ollamaTextParser.ts`
  on why `num_ctx` must match the other two parsers (a mismatch "did not
  answer within 240 s — which is why a hotel confirmation timed out");
  `config/constants.ts` on why a seed needs 1000 rows, not one ("measured in
  the wild at 57 rows"). A comment restating the line below it is noise.
- **Never document an invariant you do not test.** The OpenAPI description of
  `/stats/timeseries` claimed it grouped by "the departure airport's calendar
  day". `utils/stats/timeseries.ts` buckets on `getUTCFullYear` /
  `getUTCMonth` and never consults the timezone map the same route builds for
  durations. No test could have caught it: `stats.timeseries.test.ts` stubs
  the airport cache empty, so the zone is structurally unobservable. The claim
  was deleted rather than left standing, and the endpoint sits on the OpenAPI
  ratchet until it can be described truthfully. An empty spec beats a
  confident one.
- **A visible change goes in the changelog, even when it is a fix.** `Fixed`
  is the largest section of 2.6.0; 2.5.1 and 2.5.2 are fix-only releases. Each
  entry is a sentence a user would recognise, then the cause — "**A backup no
  longer loses every photograph.** The file archive carried three of the six
  upload directories"; "**Flight costs are no longer added across
  currencies.** 300 USD and 300 EUR were reported as '600 €'". Never "various
  improvements".
- **A bounded query bounds the work, not the scan.** `take`/`skip` belong in
  the Prisma call, and a bound needs a total ordering to be correct — hence
  the tie-breaker in `routes/flights.ts` ("departureTime is nullable and not
  unique, so paginating on it alone would skip/duplicate rows at the 500-row
  page boundaries"). Where the sort key is derived and cannot be pushed down,
  the order is sort-then-slice and says so (`routes/lodging.ts`). Unevenly
  held: `/stats/routes` and `routes/achievements.ts` load the full set and
  `.slice()` in JS.
- **Every behaviour change ships with a test that fails without it.** Not
  test-first — the guard lands beside the change and names the bug in its
  title. Where a test cannot see the thing, say so: the airline-logo chain
  shipped an invisible logo in 2.5.0-beta.1 "and every unit test passed while
  it was invisible", so changes there get a browser look, not just green
  tests.
- **Zod at every boundary; no `console.log`; `async/await`, never `.then()`;
  spread instead of mutation; `strict: true`.** Real, and none of them
  checked — `no-console` is explicitly `'off'` in the backend eslint config,
  and nothing looks for an unvalidated `req.body`.

### Global rules this project deliberately does not follow

`~/.claude/rules/common/*` lives outside this repo and cannot be corrected
from it, so the divergence is recorded here.

- **Repository pattern** — Prisma is called from routes and services directly;
  there are no repositories, and adding a layer would be a rewrite with no
  beneficiary. Single-source-of-truth work happens in `shared/*` instead.
- **The `{success, data, error}` envelope on every response** — this API has
  two shapes, one per router family (bare for flights/stats/auth/settings,
  enveloped for lodging/places/cruises/imports), and every client including
  the Companion reads the shape its router speaks. Settled on 2026-09-05 in
  `docs/adr/0001-api-response-shape.md`: both stay, a router never mixes
  them, a new router declares its family in the ratchet baseline.
- **The model-selection table** (Sonnet/Opus/Haiku) — stale, and a harness
  setting rather than a property of this code.
- **Mandatory agent usage** ("planner for complex features", "code-reviewer
  after writing code") — solo project, no PR ceremony; the gate is the Build
  Checks list, not a roster.
- **"TDD is MANDATORY, write the test first"** — replaced by the weaker, truer
  rule above: every behaviour change ships with a test that fails without it.
  Order is not the point.
- **80% minimum coverage** — not measured here, so not claimed.

### Open — do not settle these in passing

Nothing at the moment. The 800-line number was the last entry and was
ratified on 2026-09-05. Thirteen design-system decisions from the same day
are recorded, with the owner's answer to each, in
`ClaudeDesign/handoff/2026-09-05-web-redesign-rueckmeldung.md` §9 — read
that table before re-opening any of them (dashboard tabs stay; `domainColors`
stays as the beta override; tours are ONE domain colour; the parser goes into
the beta registry; settings become one route per group; companions and tags
extend to all four domains).

## Version

Source of truth: `backend/VERSION`.

Version bumps and changelog entries are managed by the `/deploy` skill
— do not edit them manually.

## Security

How it is built (facts): JWT in an HttpOnly cookie, never `localStorage`;
Zod schemas at every boundary, in `backend/src/schemas/`; Prisma everywhere,
so no hand-built SQL; React's own escaping and no `dangerouslySetInnerHTML`;
`express-rate-limit` on auth and expensive endpoints. Secrets come from a
gitignored `.env`, and the JWT/encryption keys are generated on first boot into
`/app/data/secrets/` (a subdir of the single data volume).

Of these, only two are checked: `detect-private-key` in
`.pre-commit-config.yaml` stops a key entering a commit, and
`apiNoStore.test.ts` holds the `Cache-Control` default. The rest is practised.
`scripts/security-scan.sh` is a sweep you run, not a gate.

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

This project is indexed by GitNexus as **TravStats** (8925 symbols, 23607 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
| `forgejo` | `ssh://git@<forgejo-host>:2222/dennis/TravStats.git` | Private Vollsicherung im Haus, inkl. aller lokalen Branches |

**Regel beim Pushen:**

```bash
git push origin <branch>    # oeffentlich, wie bisher
git push forgejo --all      # zusaetzlich IMMER - alle lokalen Branches
git push forgejo --tags
```

Der zweite Befehl ist der entscheidende. Am 1. August 2026 existierten
15 Branches ueber vier Repositories ausschliesslich lokal, obwohl alle ein
GitHub-Remote hatten.

**Dateien, die `.gitignore` hier ausschliesst** (`AGENTS.md`, `CLAUDE.local.md`,
`roadmap.local.yaml`, `ROADMAP.local.md`, Pentest-Notizen), liegen im Begleitrepo
**`TravStats-local`** auf Forgejo. Git kennt keine Ignore-Regeln pro Remote,
deshalb der Umweg.

> **`CLAUDE.md` gehoert NICHT dazu** — sie ist hier getrackt und oeffentlich, trotz
> der `*.md`-Regel in `.gitignore`. Sie reist also als normaler Commit nach GitHub
> und Forgejo. Eine Kopie im Spiegel waere eine dritte Quelle, die nur driften kann;
> am 25.08.2026 war genau das der Fall. Gemessen: `CLAUDE.md` und `README.md` sind
> die einzigen zwei Dateien, die beide Repos tracken — beide sind vom Spiegeln
> ausgenommen.

### Der Spiegel wird von JEDEM Rechner gepflegt (seit 2026-08-25)

`TravStats-local` liegt als Schwester-Checkout **neben** diesem Repo
(`../TravStats-local`) und traegt `sync-local-mirror.sh`:

```bash
cd ../TravStats-local
./sync-local-mirror.sh status   # was weicht ab, wer ist voraus
./sync-local-mirror.sh pull     # Spiegel -> Arbeits-Checkout (Sitzungsanfang)
./sync-local-mirror.sh push     # Arbeits-Checkout -> Spiegel (Sitzungsende)
```

**`pull` beim Sitzungsanfang, `push` am Ende — auf beiden Rechnern.** Das ist
kein Ritual, sondern die einzige Absicherung: ein `git pull` traegt diese
Dateien nie, weil sie hier ignoriert sind.

**Warum die Regel existiert:** bis zum 25.08.2026 pushte nur CT142 in den
Spiegel, der PC kuratierte still seine eigene Fassung. Gemessen an dem Tag:
`roadmap.local.yaml` hatte 50 gemeinsame Item-Ids, **120 nur auf dem PC und 18
nur im Spiegel** — keine Seite war Obermenge, ein Kopieren haette also in jede
Richtung echte Kuratierung geloescht. Das Zusammenfuehren kostete eine Sitzung.
Deshalb bricht das Skript ab, wenn beide Seiten sich bewegt haben, statt zu
kopieren.

Nicht gespiegelt, mit Absicht: `README.md` (gehoert dem Spiegel),
`.roadmap/*` (Leitstand-Build-Artefakte), `.claude/settings.local.json` und
`.claude/worktrees/*` (maschinenspezifisch).

**Secrets gehoeren in keines von beiden** — dafuer ist Infisical zustaendig
(CT 141, `<secrets-host>`).

Vollstaendiges Konzept: `D:\Projekte\CC\docs\git-konzept.md`
