# Airline & Aircraft Catalogue — Design (#189 + #191)

> Part of the 2.5.0 batch (owner: "alles erst einbauen"). Turns airlines and
> aircraft into seeded Prisma tables mirroring the existing Ship/Port master-data
> pattern, retires the hand-maintained airline lists, and makes the keyless logo
> lookup work for essentially every carrier.
>
> Decisions locked with the owner 2026-07-16; reviewed cold by Codex (gpt-5.4,
> read-only) — its concrete catches are folded in and attributed inline.

## Goal

- `Airline` and `Aircraft` become **seeded Prisma tables** (like `Ship`/`Port`).
- User-added rows survive re-seeds via an `isUserAdded` seed-guard.
- The parser + flight write-paths resolve airline/aircraft codes against the
  **table** (via a cached resolver), not the hardcoded `backend/src/data/airlines.ts`.
- Retire **all four** hand-maintained frontend/backend airline lists.
- Backfill `airline_iata`/`airline_icao` onto already-stored flights.
- Seed airlines from OpenFlights `airlines.dat` (~6k) so the IATA-keyed logo
  lookup (kiwi.com tier) resolves for nearly every carrier.

Non-goals (YAGNI, deferred): PATCH/DELETE on catalogue rows (create-only first
cut, like ships/ports); a real `Flight.airlineId` foreign key; multi-container
cache coherence; airport master-data editing (already covered by `#191`'s
`/admin/airports/reseed`).

## Decisions (and why)

### D1 — Model shape: denormalized snapshot, NO foreign key
`Flight.airline / airlineIata / airlineIcao` (and `aircraft`) stay nullable
string snapshots. A logbook entry is a historical record — a 2019 flight must
keep its 2019 airline name/code even if the carrier later rebrands or the code
is reused. A FK would force per-write resolution, unresolved-airline handling
for thousands of non-matching carriers, and a bigger backfill — all to model
data we deliberately want frozen. Codex concurred: snapshot semantics are the
right default for this shape.

Instead, the **resolver** changes: the current synchronous static-map lookup
(`airlineNormalize.ts:105`, `aircraftNormalize.ts`) is rebuilt from an
**in-memory cache preloaded from the tables at boot**, invalidated when an admin
creates a row. Prod runs a single container, so process-local invalidation is
correct. A TTL / `updatedAt`-version check is deferred until (if ever)
multi-container becomes real — noted, not built.

### D2 — Frontend source: full ~6k vendored catalogue
The generated mirror `frontend/src/lib/generated/airlineCatalog.ts` is
regenerated **from the DB seed** with the full ~6k rows (replacing today's 147),
keeping display + name→IATA logo resolution fully offline/keyless. The owner
accepts the ~300–500KB bundle cost in exchange for complete offline coverage.

Acknowledged tradeoff (Codex): a vendored file is **not live** — an admin-added
airline is invisible to the offline catalogue until the next regen+build. That
is acceptable because (a) the in-form **picker** and admin manager search the
**live table** via API, and (b) post-backfill stored flights already carry their
IATA, so the catalogue is mostly a legacy free-text→IATA fallback.

### D3 — Migration: `prisma migrate dev` normally (blocker dissolved)
The CLAUDE.md "schema drift blocks migrate dev" gotcha is **stale**. Verified
2026-07-16 via `prisma migrate diff`:
- live dev DB → `schema.prisma`: **empty diff**
- migration-history replayed on a fresh shadow DB → `schema.prisma`: **empty diff**
  (all 79 migrations replay cleanly)

A later migration already reconciled the historical drift (NOT-NULL flips, DROP
INDEX). The only remaining artifact is one **failed migration marker on the
local dev DB**: `20260712113158_add_logostream_api_key` (a simple `ADD COLUMN`
whose column already exists — the live diff is empty, so it applied).

Approach:
1. `prisma migrate resolve --applied 20260712113158_add_logostream_api_key` on
   the dev DB (safe: the column provably exists).
2. Generate the Airline/Aircraft migration **normally** via `prisma migrate dev`
   — additive only (two `CREATE TABLE`s + indexes).

No hand-written migration, no prod-drift audit.

**Prod pre-flight (before `migrate deploy` ships this):**
- `prisma migrate status` against prod reports **no failed migrations**.
- `prisma migrate diff --from-url "$PROD_DATABASE_URL" --to-schema-datamodel
  backend/prisma/schema.prisma` is **empty** *before* adding this feature migration.
- prod `_prisma_migrations` does **not** carry the same failed logostream marker
  (if it does, resolve it there only after proving the column exists — never
  blind).
- The generated migration is **additive only** (no destructive statements).

### D4 — Aircraft seed: UNION (curated wins)
Seed from OpenFlights `planes.dat` **∪** curated `aircraftTypes.ts`, merged on
ICAO, **curated winning** on conflict. `planes.dat` alone is a coverage
regression: `normalizeAircraft` depends on curated codes/aliases (e.g.
`AT72 → "ATR 72-500"`) that the thin (~250-row) OpenFlights set does not
reliably carry.

Pre-clean the curated data first — it has rows a `@unique(icao)` table will
reject (Codex): duplicate `A20N` (mapped to *both* A220-100 and A320neo,
`aircraftTypes.ts:14` & `:22`) and non-ICAO-length values like `A321XLR`
(`:25`). Cleanup lands as an explicit, reviewed change, not a silent seed-time
drop.

### D5 — Airline key & dedup: `iata @unique`, prefer active
Keep the Ship/Port pattern — one nullable natural key `iata String? @unique`.
OpenFlights has blank + reused IATA codes (defunct + active carriers share
codes), so the seed:
- **groups by IATA, keeps the `active` carrier** on collision;
- **drops blank-IATA rows** — a carrier with no IATA cannot feed an IATA-keyed
  logo lookup and would be dead weight.

`icao` is stored but **not** uniquely constrained (OpenFlights ICAO is also
dirty/non-unique).

## Architecture

### Prisma models (`backend/prisma/schema.prisma`)
```prisma
model Airline {
  id          Int     @id @default(autoincrement())
  iata        String? @unique
  icao        String?
  name        String
  callsign    String?
  country     String?
  active      Boolean @default(true)
  isUserAdded Boolean @default(false) @map("is_user_added")

  @@index([name])
  @@index([icao])
  @@map("airlines")
}

model Aircraft {
  id          Int     @id @default(autoincrement())
  icao        String? @unique
  name        String
  isUserAdded Boolean @default(false) @map("is_user_added")

  @@index([name])
  @@map("aircraft")
}
```
`Flight` unchanged.

### Seeding (`backend/src/seedAirlinesFromData.ts`, `seedAircraftFromData.ts`)
Copy the **ports** bulk pattern (`seedPortsFromCSV.ts:48-91`): one `findMany` of
existing natural keys → filter candidates in memory → single
`createMany({ skipDuplicates: true })`. Do **not** copy the ships per-row
`findUnique+create` loop (`seedShipsFromCSV.ts:35-57`) — it re-inserts on every
boot.

- Seeded rows are `isUserAdded:false`; the skip logic matches on the natural key
  only, so admin `isUserAdded:true` rows are never overwritten.
- Vendored data: `backend/data/openflights/airlines.dat`, `planes.dat` (committed
  to the repo and copied into the Docker image, like the marnet GeoJSON).
- Boot trigger: `backend/src/index.ts` alongside the existing seedPorts/seedShips
  calls — each in its own try/catch, never blocks boot.
- Re-sync: `POST /api/v1/admin/airlines/reseed` + `GET .../seeding-status`,
  mirroring `admin/system.ts:84-141` (`adminReseedLimiter`). Reseed invalidates
  the resolver cache.

### Resolver (`airlineNormalize.ts`, `aircraftNormalize.ts`)
- A small cache module loads the tables into the same map shapes the code uses
  today (`AIRLINE_IATA_MAP`, `AIRLINE_ICAO_MAP`, `NAME_TO_IATA`, aircraft maps),
  preloaded at boot and re-buildable on demand (admin create / reseed).
- **Public resolver signatures stay synchronous** (they read the in-memory
  cache), so the many call sites — `flights.ts:266,910`, `flightsBatch.ts:89,92`,
  `stats.ts:209,1008`, `funStats.ts:88`, `flightLookup.ts:1091-1095`,
  `suggestions.ts` — do not need async plumbing. Blast radius stays contained to
  the resolver module's internals.
- **Curated aliases are preserved**: the hand-picked `NAME_TO_IATA` aliases and
  aircraft aliases stay **in the normalizer code exactly as they are today** — no
  new alias table (YAGNI). Only the base catalogue maps move to the DB cache; the
  alias layer sits in front of them unchanged. OpenFlights breadth does not
  replace those aliases.
- Behaviour invariant kept: strict-exact match, **returns `null` not a guess**
  (#106B philosophy).

### Backfill (`backend/src/scripts/backfillAirlineCodes.ts`)
One-shot, idempotent: for stored flights missing `airline_iata`/`airline_icao`,
resolve from the (now DB-backed) resolver and fill. Mirrors the existing boot
aircraft-normalization at `index.ts:375-383`. Run once on deploy; safe to re-run.

### Routes (`backend/src/routes/airlines.ts`, `aircraft.ts`)
Mirror `ships.ts`/`ports.ts`, mounted at `/api/v1/airlines`, `/aircraft`.
Guard: `authenticate` + `requireWriteScope` (the /admin frontend route gates the
UI). `GET /` (Zod list query, ILIKE search, capped/paginated — never returns the
full 6k unbounded), `POST /` (Zod create, forces `isUserAdded:true`, invalidates
cache). No PATCH/DELETE first cut. `suggestions.ts` airline/aircraft endpoints
become **search-param-driven**, never dumping all names into a datalist.

### Frontend
Retire **all four** lists:
1. `backend/src/data/airlines.ts` (deleted)
2. `frontend/src/lib/generated/airlineCatalog.ts` — regenerated from DB seed
   (`backend/scripts/generate-airline-catalog.ts` re-sourced from the Airline
   table instead of airlines.ts)
3. `frontend/src/lib/constants.ts` `AIRLINES` (used by `Filters.tsx:393,415,418`)
4. `frontend/src/lib/airline-parsers/bcbpHelpers.ts:127` — the fourth
   hardcoded map Codex flagged

- Drift-guard test (`dataIntegrity.airlineCatalog.test.ts`) re-points to
  "vendored mirror matches the DB seed output".
- Admin: new `frontend/src/components/Admin/AirlineAircraftMasterData.tsx`
  (mirrors `CruiseMasterData.tsx` — an `AirlinesSection` + `AircraftSection`,
  debounced search, inline add-custom, `isUserAdded` pill), a new `ActiveSection`
  under the **flight** tab in `AdminPage.tsx`.
- API client `frontend/src/lib/api/airlines.ts` (`airlinesApi`/`aircraftApi` =
  search + create), mirroring `lib/api/cruise.ts`.
- In-form **airline picker** in the flight form (both an admin catalogue manager
  AND an end-user quick-add picker, like ships/ports have both).

## Error handling
- Seed + backfill wrapped in try/catch, structured Pino logs, never block boot.
- Zod validation on every route create/list (system boundary).
- Resolver returns `null` on no-match (never a wrong guess); callers already
  handle null.
- Reseed route rate-limited (`adminReseedLimiter`).

## Testing
- **Seed tests** (`seedAirlinesFromData.test.ts`, `seedAircraftFromData.test.ts`)
  per ships/ports precedent: fresh insert ≥N; 2nd run inserts 0; `isUserAdded`
  row survives a reseed; `beforeEach` wipes, `afterAll` re-seeds so the dev DB
  stays populated.
- **Dedup/cleanup unit tests**: blank-IATA dropped; active preferred on IATA
  collision; curated aircraft dup/invalid rows rejected/cleaned; union merge
  keeps curated on ICAO conflict.
- **Resolver-parity test**: the new DB-backed resolver returns the same answers
  as the retired `airlines.ts` for all 147 previously-known carriers — proves no
  resolution regression.
- **Backfill idempotency test**: second run is a no-op; never overwrites a
  non-null structured code.
- Full backend suite (`npm test -- --forceExit`) + frontend
  (`npx vitest --run`) + `tsc --noEmit` + lint before merge.
- Logo-cache pollution caveat: airline-logo backend tests write artifacts to the
  real dev cache — clear `backend/.travstats-data/cache/airline-logos/` after.

## Delivery
One branch `feat/airline-aircraft-catalogue` off `main`; internal phases
(migration+models → seed → resolver+backfill → routes → frontend retire+admin+picker
→ tests). Merged to `main` as a single block when complete and green — per the
2.5.0 "build the block, then merge it" rule. The merge is a separate, explicit
RELEASE decision the owner makes; it is not bundled into implementation sign-off.

## Open follow-ups (tracked, not in this spec)
- Multi-container cache coherence (TTL/version) — only if the deployment ever
  scales past one container.
- PATCH/DELETE on catalogue rows — when users ask.
