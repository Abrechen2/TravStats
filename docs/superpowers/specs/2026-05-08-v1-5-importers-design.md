# v1.5 — Importers, Onboarding & Full Provider Field Capture

**Status:** Design approved · ready for implementation plan
**Branch:** `dev/v1-5-importers` (long-running, off `main`, no commits to `main` until complete)
**Date:** 2026-05-08
**Closes:** [#99](https://github.com/Abrechen2/TravStats/issues/99)
**Roadmap:** ROADMAP.md → "📥 v1.5"

---

## 1 · Goal

Let users coming from FR24 or any other flight logbook seed TravStats on day one without writing code or doing manual timezone math, and silently expand AeroDataBox field capture so future analytics features (block-time, hull gallery, quality badges) don't need a follow-up provider re-fetch.

---

## 2 · Scope decisions (locked)

| Question | Decision | Rationale |
|---|---|---|
| MVP source coverage | **FR24 + Generic-CSV-Wizard + AeroDataBox-Schema-Pass** | FR24 closes #99 (real user demand); Generic-Wizard handles every other logbook with one piece of UI work; OpenFlights / App in the Air / FlightAware deferred until real demand surfaces (YAGNI). |
| Architecture | **Frontend parses → server `/import/preview` enriches → frontend chunks to existing `/flights/batch`** | Reuses existing transactional batch endpoint; new server code is a single read-only enrichment route; server owns TZ math (only place with airport-tz data). |
| UI surface | **`Settings → Import` as 15th sidebar section, 3 tiles (FR24 · Generic CSV · Round-Trip XLSX)** | Issue #99 author's own proposal; one discovery point; parallel to existing Backup / API-Keys sections; migration is a 1-2× per-user-lifetime action, doesn't belong in main nav. |
| Round-trip XLSX home | **Moves into Settings → Import (3rd tile)** | Single source of truth for all imports; one-time `localStorage`-flagged toast notifies users on first 1.5 load. |
| Build strategy | **Single branch, all-at-once, local dev validation, then deploy** | User preference; `dev/v1-5-importers` long-running; standard RC-first cycle on merge to `main`. |
| External-AI involvement | **Gemini for design-review (done) + Codex for post-implementation review** | Per global rule `external-ai-tools.md` — second-opinion at the two highest-stakes moments. |

### Decisions captured during design

- **DataSource enum** gets three new values (`imported_fr24`, `imported_generic_csv`, `imported_roundtrip`) rather than a separate `importSource` text column. Simpler; v2 can switch to a column if we add more sources.
- **Backfill strategy for new AeroDataBox fields:** lazy via existing `historicalEnrichment` scheduler — no boot-time work, no double-cron, only runs on instances with an AeroDataBox key configured.
- **Migration toast** ("Import has moved to Settings → Import"): one-time per user via `localStorage` flag; permanent dashboard hint considered and rejected as noise for power users.

---

## 3 · Architecture & data flow

```
File Upload → Frontend Parser → POST /import/preview (req.userId from auth)
                                         │
                                         ├─ batch airport lookup (airportCache, unique IATA/ICAO)
                                         ├─ TZ math: dep_utc = fromZonedTime(date+depTime, depTz)
                                         ├─ arr_utc = dep_utc + Duration   (FR24 — Duration is ground truth)
                                         │           | iterate +24h until ±30min sane (Generic-CSV)
                                         ├─ arrivalLocal_corrected = toZonedTime(arr_utc, arrTz)
                                         ├─ normalizeFlightNumber → dedupe-flag
                                         └─ status default + per-row flags
                                         ↓
                                  PreviewRowEnriched[] (incl. corrected wall-clock)
                                         ↓
                              Preview UI → user picks rows → POST /flights/batch (chunked 20)
                                                                    ↑
                                                  dataSource: 'imported_fr24' | 'imported_generic_csv'
                                                  Round-Trip uses PUT /flights/:id directly (separate path)
```

### Shared parser-output shape

```ts
// frontend/src/lib/importers/types.ts (new)
export interface PreviewRowInput {
  date: string;              // YYYY-MM-DD (origin local)
  depTimeLocal?: string;     // HH:MM:SS — origin-local
  arrTimeLocal?: string;     // HH:MM:SS — destination-local
  durationSeconds?: number;  // optional — ground truth for trans-meridian when present (FR24)
  fromIata: string;
  toIata: string;
  flightNumber?: string;     // raw, server normalises
  airline?: string;
  aircraft?: string;
  registration?: string;
  seatNumber?: string;
  seatClass?: SeatClass;
  category?: Category;
  notes?: string;
  source: 'fr24' | 'generic_csv';   // round-trip uses separate path
  sourceRowIndex: number;    // for preview UX (highlight row N of source file)
}
```

### Server endpoint: `POST /api/v1/import/preview`

Mounted via `app.use('/api/v1/import', importRoutes)` in `backend/src/index.ts`, matching the existing `/api/v1/<scope>` convention used for every other route module.


- **Auth:** standard auth middleware → `req.userId` is source of truth, body **must not** carry `userId` (IDOR defense).
- **Input:** `{ rows: PreviewRowInput[] }` — max 1000 rows per call. Frontend pages larger uploads.
- **Pipeline (in order):**
  1. Collect unique `fromIata`+`toIata` codes → batch-fetch via `services/airportCache.ts` → reject early if ≥1 code unresolvable (return as Class-B errors per row).
  2. For each row:
     a. `dep_utc = fromZonedTime(\`${row.date}T${row.depTimeLocal}\`, depTz)`
     b. **Trans-meridian:** if `row.durationSeconds` present (FR24): `arr_utc = dep_utc + durationSeconds`. Else (Generic-CSV): naive `arr_utc = fromZonedTime(\`${row.date}T${row.arrTimeLocal}\`, arrTz)`; if `arr_utc < dep_utc`, iterate `+24h` until `arr_utc ≥ dep_utc`, capped at 2 iterations (max +48h).
     c. **Sanity check (FR24):** `|dep_utc + duration - naive arr_utc derived from Date+ArrTime+arrTz| > 30min` → flag `duration_mismatch` warning, but trust Duration.
     d. `arrivalLocal_corrected = formatInTimeZone(arr_utc, arrTz, "yyyy-MM-dd'T'HH:mm:ss")` — this is what `/flights/batch` will validate against `createFlightSchema`'s `departureLocal <= arrivalLocal` refinement (line 223).
     e. `flightNumber_normalised = normalizeFlightNumber(row.flightNumber)` — using existing helper from `schemas/flight.ts`.
     f. `dedupe-hint = lookupExistingFlight(userId, dep_utc, flightNumber_normalised)` → `'exact_match' | 'same_day_same_route' | 'none'`. Same rule as `routes/flights.ts` POST de-dupe (issue #84 fix — normalised number + same day in JS, not raw SQL).
     g. `status_default = dep_utc < now() ? 'flown' : 'scheduled'`.
- **Output:**
  ```ts
  interface PreviewRowEnriched extends PreviewRowInput {
    depUtc: string;           // ISO
    arrUtc: string;           // ISO
    arrivalLocalCorrected: string; // ready for /flights/batch
    depTimezone: string;
    arrTimezone: string;
    depLat: number;
    depLon: number;
    arrLat: number;
    arrLon: number;
    flightNumberNormalised: string;
    statusDefault: 'flown' | 'scheduled';
    flags: Array<'duration_mismatch' | 'unresolvable_airport' | 'missing_required'>;
    dedupeHint: 'exact_match' | 'same_day_same_route' | 'none';
  }
  interface PreviewResponse {
    rows: PreviewRowEnriched[];
    summary: { ok: number; problems: number; duplicates: number; unresolvable: number };
  }
  ```
- **No DB writes.** Preview is ephemeral; reload = re-upload (acceptable for MVP).

### Commit path

Frontend takes `PreviewRowEnriched[]` filtered by user-checked rows, chunks to 20, posts to **existing** `POST /flights/batch` with:

```ts
{
  airline: row.airline,
  flightNumber: row.flightNumberNormalised,
  // ... other fields ...
  departureLocal: \`${row.date}T${row.depTimeLocal}\`,
  arrivalLocal: row.arrivalLocalCorrected,    // <-- key: corrected wall-clock
  depTimezone: row.depTimezone,
  arrTimezone: row.arrTimezone,
  status: row.statusDefault,
  dataSource: 'imported_fr24' | 'imported_generic_csv',
}
```

`/flights/batch` re-runs `enrichFlightAirports` and re-derives UTC — both already idempotent. The corrected `arrivalLocal` ensures the `departureLocal <= arrivalLocal` Zod refinement passes for IDL-westbound flights (Section 2 of Gemini review).

### Round-Trip XLSX (separate path)

Round-Trip uses `id`-based update-mode that `/flights/batch` doesn't support; relocates today's Dashboard logic from `pages/DashboardPage.tsx#parseImportFile` → `components/import/RoundTripImportTile.tsx` 1:1, calling `PUT /flights/:id` for rows with `id` and `POST /flights/batch` (no preview) for rows without. No new backend code.

---

## 4 · Schema deltas

### Migration A — `add_imported_dataSource_values`

```prisma
// schema.prisma
enum DataSource {
  manual
  email_import
  boarding_pass_scan
  historical_enrichment
  live_update
  api_lookup
  bulk_import
  imported_fr24         // NEW
  imported_generic_csv  // NEW
  imported_roundtrip    // NEW
}
```

Plus the four touchpoints flagged by Gemini:

1. `backend/src/schemas/flight.ts` — extend Zod `dataSource` enum (line ~163)
2. `frontend/src/components/DataSourceBadges.tsx` — add badge mapping (color + icon) for the three new values
3. `frontend/src/i18n/resources/de/flights.json` — add `dataSource.imported_fr24` etc. labels
4. `frontend/src/i18n/resources/en/flights.json` — same

### Migration B — `add_aerodatabox_extended_fields`

```prisma
model Flight {
  // ... existing ...
  // AeroDataBox runway times are wheels-up / wheels-down — distinct from
  // existing actualDeparture/actualArrival which are off-block (gate pushback /
  // gate arrival). Both are persisted independently when AeroDataBox returns them.
  runwayDepartureTime         DateTime?    // NEW — wheels-up UTC (takeoff)
  runwayArrivalTime           DateTime?    // NEW — wheels-down UTC (touchdown)
  isCargo                     Boolean?     // NEW
  aerodataboxLastUpdatedUtc   DateTime?    // NEW — for freshness debugging
  aerodataboxQualityTags      String[]     // NEW — Postgres array
  baggageBelt                 String?      // NEW
  checkInDesk                 String?      // NEW
}

model Airport {
  // ... existing ...
  shortName                   String?      // NEW
  municipalityName            String?      // NEW
  // `timezone` (lowercase z) already exists — used by enrichFlightAirports today
}
```

All columns are nullable / additive — zero-downtime, idempotent (`IF NOT EXISTS`).

### Skipped on purpose (per ROADMAP.md)

- `aircraft.image` — CC-BY-SA attribution requirement; defer until v2 hull-gallery UI exists (no legal display obligation today)
- `distance.{meter, mile, nm, feet}` — redundant with existing `distanceKm`; derive on read

---

## 5 · Components

### Backend — new

| File | Purpose |
|---|---|
| `routes/import.ts` | `POST /import/preview` route handler — auth-gated, `req.userId` only, max 1000 rows |
| `services/importPreview.ts` | Core enrichment logic (batch-airport-lookup via `airportCache`, TZ math, normalize, dedupe-hint, per-row flags) |
| `services/importGenericCsvSpec.ts` | Server-side validation of column-mapping spec from the Generic-Wizard (defense vs. mapping injection — user can't request internal/admin field mappings) |
| `__tests__/importPreview.test.ts` | Unit tests covering Issue-#99 golden-master CSV + IDL edge cases |
| `__tests__/import.routes.test.ts` | Integration tests: auth, IDOR, oversized-payload rejection, malformed input |
| `__tests__/fixtures/fr24-sample.csv` | Synthetic golden-master from Issue #99 (jay-tau) — committed as fixture |

### Backend — changes

| File | Change |
|---|---|
| `schemas/flight.ts` | (a) Extend `dataSource` Zod enum with 3 new values. (b) Extend `baseFlightSchema` with the 9 new AeroDataBox-derived fields (`runwayDepartureTime`, `runwayArrivalTime`, `isCargo`, `aerodataboxLastUpdatedUtc`, `aerodataboxQualityTags`, `baggageBelt`, `checkInDesk`, `Airport.shortName`, `Airport.municipalityName`) — without these, Zod strips the columns on every POST/GET and Migration B becomes invisible to the API. (c) Extract the inline flight-number normalisation transform (currently lines 80-82) into a top-level **exported `normalizeFlightNumber(v: string): string \| undefined`** helper so `services/importPreview.ts` can reuse it without code duplication |
| `services/aerodataboxLookup.ts` | Map new fields (`runwayTime`, `quality`, `isCargo`, `lastUpdatedUtc`, `baggageBelt`, `checkInDesk`) from API response into `FlightLookupResult` |
| `services/historicalEnrichment.ts` | Existing scheduler picks up new fields when re-fetching — no new cron, no boot-time backfill |
| `index.ts` | Mount `routes/import.ts` at `/api/v1/import` (matching existing prefix convention) |

### Frontend — new

| File | Purpose |
|---|---|
| `lib/importers/types.ts` | `PreviewRowInput`, `PreviewRowEnriched`, source-id union |
| `lib/importers/fr24.ts` | FR24-CSV parser plug-in: handles leading blank line, embedded `(IATA/ICAO)`, numeric codes (Seat type / Flight class / Flight reason), varied registrations, no-PNR |
| `lib/importers/genericCsv.ts` | Generic parser: takes raw CSV + user-defined column-mapping → `PreviewRowInput[]` |
| `lib/importers/index.ts` | Plug-in registry (source-id → parser fn) |
| `pages/settings/ImportSection.tsx` | Settings-section host for the 3 tiles |
| `components/import/Fr24ImportTile.tsx` | File drop-zone + parse + preview-modal trigger |
| `components/import/GenericCsvImportTile.tsx` | Upload + column-mapping wizard + preview-modal trigger |
| `components/import/RoundTripImportTile.tsx` | Relocates today's Dashboard logic 1:1; uses `PUT /flights/:id` for `id`-bearing rows, `POST /flights/batch` for new rows |
| `components/import/PreviewModal.tsx` | Shared modal: row table + per-row checkbox + flag badges + commit-to-batch dispatcher |
| `components/import/ColumnMappingWizard.tsx` | Drag-from-CSV-header → drop-on-TravStats-field UI for Generic-CSV |
| `__tests__/fr24.test.ts` | Parser-only unit tests, all 8 jay-tau edge cases |
| `__tests__/genericCsv.test.ts` | Mapping-spec validation, type-coercion |
| `__tests__/PreviewModal.test.tsx` | Commit-click chunks correctly, partial-failure UX |

### Frontend — changes

| File | Change |
|---|---|
| `pages/SettingsPage.tsx` | Insert `{ id: 'import', label: t('settings:import.title') || 'Import' }` into `sections` array, render `<ImportSection />` when active |
| `pages/DashboardPage.tsx` | Remove `handleImport`, `parseImportFile`, `rowToUpdates`, the file `<input>`, the "Import" dropdown button. Add one-time `localStorage`-flagged toast: "Import has moved to Settings → Import" |
| `components/DataSourceBadges.tsx` | Add 3 new badge mappings with distinct colors and icons (suggest: 📊 fr24 / 📥 generic / ↻ roundtrip) |
| `i18n/resources/de/flights.json` + `en/flights.json` | New keys: `dataSource.imported_fr24`, `dataSource.imported_generic_csv`, `dataSource.imported_roundtrip`, `settings.import.title`, `settings.import.tile.fr24.*`, `settings.import.tile.genericCsv.*`, `settings.import.tile.roundTrip.*`, `settings.import.preview.*`, `settings.import.toast.movedFromDashboard` |

---

## 6 · Error handling

| Class | Where | Example | UX |
|---|---|---|---|
| **A — Parser error** | Frontend, pre-server | Malformed CSV, unrecognized FR24 header | Toast + docs link, no server roundtrip |
| **B — Per-row hard error** | Server `/import/preview` | IATA not in airport DB, TZ-lookup empty, malformed time | Row stays in preview, **red badge**, tooltip explaining cause, **auto-unchecked, no recovery affordance**. The row cannot be committed as-is because `createFlightSchema` requires `lat`/`lon`/`tz` from the airport lookup — re-checking would just guarantee a `/flights/batch` 400. User must fix the source CSV (correct an unrecognized IATA code, etc.) and re-upload |
| **C — Per-row warning** | Server `/import/preview` | `dedupe-hint != 'none'`, `duration_mismatch`, optional field missing | **Yellow badge**, tooltip, **checked by default**, user decides |
| **D — Commit-chunk error** | `/flights/batch` | Single row Zod-fails, DB constraint violation, transient DB error | **Chunks are atomic.** `flightsBatch.ts` wraps all 20 rows in `prisma.$transaction`, so one row failing rolls back the entire chunk. UI behaviour: when a chunk responds 4xx, mark **all 20 rows in that chunk** as failed (red badge), surface the server's error message at chunk level (e.g. "row 14 had an unrecognised seat-class"), let user fix the source row(s) and retry the chunk. Successful chunks before the failed one stay committed; chunks after are not attempted. **Mitigation:** the preview is comprehensive enough that almost all Zod failures are caught client-side before commit, so chunk-level failures should be rare (mostly transient DB issues, not data issues) |
| **E — Network error** | Either side | Connection drop during preview / commit | Preview: re-upload prompt. Commit: cursor in `localStorage` so user can resume from last successful chunk |

---

## 7 · Migration & deploy plan

**Pre-deploy on `dev/v1-5-importers`:**

1. Migrations A + B applied locally via `npx prisma migrate dev`
2. All workstreams committed in separate commits per the workstream split (Schema, FR24, Generic-Wizard, Settings-UI, Round-Trip-Migration, AeroDataBox-Mapping, Tests)
3. Regular `git merge main` into the dev branch (per CLAUDE.md long-running-feature rule, never rebase)

**Local validation (user gate before deploy):**

- Stack 1 (main, port 8000/3000) as comparison baseline
- Stack 2 (`dev/v1-5-importers` worktree, port 8001/3001) with the new code — pattern documented in `CLAUDE.local.md`
- Manual smoke against `__tests__/fixtures/fr24-sample.csv` via browser
- **Codex review pass:** I'll submit `services/importPreview.ts`, `lib/importers/fr24.ts`, and the new tests cold to Codex (no chat context) for an independent critique. Surface any substantive findings to user before merge.
- Full E2E suite green against Stack 2

**Deploy:**

- `git checkout main && git merge --no-ff dev/v1-5-importers`
- `/deploy` cuts `1.5.0-rc.1`, deploys to Underworld
- jay-tau UAT loop on `1.5.0-rc.x`
- User "promote" → `:1.5.0` / `:latest` / `:stable` cut via `docker buildx imagetools create` (byte-identical retag)
- Docker Hub mirror + `/release` final GitHub release

**Rollback realism:**

`Flight.dataSource` is currently `String?` in `prisma/schema.prisma` (line 172) — **not** a native Postgres enum. So Migration A is purely a Zod-layer change; the database accepts any string. Migration B is additive nullable columns; old code just ignores them.

**Application-layer concern only:** if the user rolls back the image from 1.5 to 1.4, the 1.4 Zod parser does not know `imported_fr24` / `imported_generic_csv` / `imported_roundtrip` — `dataSource: z.enum([...])` will reject those strings on every read of an affected flight. The Dashboard / API endpoints would then 500 for users who imported during 1.5.

**Operating model:** v1.5 is a **fix-forward** release. If a catastrophic 1.5 bug appears, the path is "deploy `1.5.x` with the fix," not "redeploy 1.4."

**If true rollback to 1.4 becomes necessary** (e.g., 1.5 corrupted user data and we need the old image running NOW):

```bash
# Neutralise the new dataSource values BEFORE redeploying 1.4 — this collapses
# imported_* rows back to bulk_import, which 1.4's Zod enum already accepts:
docker exec travstats-db psql -U flights -d flights -c \
  "UPDATE flights SET data_source = 'bulk_import' WHERE data_source LIKE 'imported_%';"
# (Migration B nullable columns stay in the DB; 1.4 silently ignores them)
```

Document this in `docs/runbooks/rollback-1-5-to-1-4.md` as a deploy artefact when 1.5 ships.

**Caveat on `bulk_import` as the rollback collapse target:** the existing `bulk_import` value is the catch-all for "ad-hoc bulk operations" and is not heavily used in dashboard filters today, so collapsing the three new values onto it is a low-cost lossy decision. After fix-forward redeploy of 1.5, the per-source granularity returns from the new imports onwards but is not retroactively recoverable for the rolled-back rows.

**Frontend rollback:** old image redeployed; `Settings → Import` section just doesn't render. Old Dashboard import button is gone but the dismissed-toast `localStorage` flag survives the rollback, so users won't be re-prompted later. Acceptable.

---

## 8 · Testing strategy (≥80% coverage per CLAUDE.md)

### Backend (Jest)

- `importPreview.test.ts` — golden-master against `__tests__/fixtures/fr24-sample.csv`. Cover all 9 edge cases:
  1. Leading blank line
  2. IDL-westbound (LAX→SYD, +48h derivation via Duration)
  3. IDL-eastbound
  4. Intra-day connection (multi-leg same-day)
  5. Mismatched duration (Duration vs derived UTC delta)
  6. Missing IATA (Class-B unresolvable_airport flag)
  7. All numeric-code mappings (Seat type 1/2/3, Flight class 1-5, Flight reason 1-4)
  8. Registration format variations (D-ABYD, N755AN, VH-OQB, 9V-SCD, TC-JOA)
  9. **Malformed Date or Time** (`2024-02-30`, `25:00:00`, empty `Date` cell) — must be caught by the parser as Class-A error before reaching server-side TZ math; `fromZonedTime` returning Invalid-Date should never propagate into a 500
- `import.routes.test.ts` — Auth tests including IDOR-defense (body-`userId` ignored), oversized-payload (>1000 rows) rejected, malformed-JSON rejected
- `aerodataboxLookup.test.ts` — Extend with new field mappings (`runwayTime`, `isCargo`, `qualityTags`, `baggageBelt`, `checkInDesk`) from mock API response → DB
- `flightsBatch.test.ts` — Regression: `dataSource` enum extension doesn't break existing flows

### Frontend (Vitest)

- `fr24.test.ts` — parser-only, decoupled from UI (blank-line, quoted-comma, unicode, BOM)
- `genericCsv.test.ts` — column-mapping validation
- `PreviewModal.test.tsx` — commit-click chunks to 20, partial-chunk-failure UX, resume-button
- `ImportSection.test.tsx` — sidebar routing, tile click opens correct wizard

### E2E (Playwright)

- **Critical Path 1 — FR24 happy path:** Settings → Import → FR24 tile → upload golden sample → preview shows all rows green → confirm → Dashboard shows flights with `imported_fr24` badge
- **Critical Path 2 — Re-upload dedup:** Same FR24 file again → preview shows yellow Duplicate badges → skip-duplicates button → Dashboard unchanged
- **Critical Path 3 — Generic-Wizard:** upload custom CSV → drag-drop column mapping → preview → confirm → flights present with `imported_generic_csv` badge
- **Critical Path 4 — Round-Trip:** export from Settings → edit Excel cell → re-import via Settings → confirm → existing flight updated, no duplicate created

---

## 9 · Reviews (cross-AI involvement)

Per global rule `~/.claude/rules/common/external-ai-tools.md` — second-opinion at the two highest-stakes moments.

**Gemini — design review (DONE):**

Run on Section 1 of this design via `gemini-cli` skill. Substantive findings incorporated:

1. ❌ Original `arr_utc < dep_utc → +24h` rule failed for IDL-westbound (LAX→SYD requires +48h, or use Duration as ground truth) → **fixed:** Duration is now ground truth for FR24
2. ❌ `createFlightSchema` enforces `departureLocal <= arrivalLocal` (line 223) — naive `arrivalLocal` would fail validation → **fixed:** preview returns `arrivalLocalCorrected` with adjusted date
3. ❌ Round-Trip needs `id`-based update mode that `/flights/batch` doesn't support → **fixed:** Round-Trip is a separate path using `PUT /flights/:id`
4. ❌ IDOR risk — body-`userId` must never be trusted → **fixed:** `req.userId` from auth middleware only
5. ❌ Airport-lookup perf at 1000 rows (2000 individual lookups) → **fixed:** batch unique-codes via `airportCache.ts`
6. ❌ Normalize-drift — must use existing `normalizeFlightNumber` → **fixed:** explicit reuse from `schemas/flight.ts`
7. ❌ DataSource UI multi-touchpoint (Zod + Badges + DE i18n + EN i18n) → **fixed:** all 4 touchpoints enumerated in §5

Gemini noise (rejected): theoretical race between `/preview` and `/batch` enrichment — `enrichFlightAirports` runs in `/batch` anyway, idempotent.

**Gemini second-pass review (DONE 2026-05-08):**

After the spec doc was written and committed, Gemini was given the full spec cold for a follow-up review. 8 substantive findings, all verified against the codebase, all fixed in the same spec document:

1. ✅ **`normalizeFlightNumber` not exported** — was an inline transform at `schemas/flight.ts:80-82`, not a named helper. Spec now requires the refactor (extract to top-level export).
2. ✅ **AeroDataBox-fields missing from Zod schema (BLOCKER)** — §5 only enumerated the `dataSource` enum touchpoint and missed extending `baseFlightSchema` with the 9 new columns. Without that, Zod silently strips them on every POST/GET. Now explicitly listed.
3. ✅ **`runwayDepartureTime` semantic confusion** — labelled "off-block" originally; off-block = gate pushback (already covered by `actualDeparture`). The AeroDataBox `runwayTime` is wheels-up/touchdown. Now clarified.
4. ✅ **`Airport.timeZone` casing** — actual schema has lowercase `timezone`. Fixed.
5. ✅ **`dataSource` Postgres-enum overstatement** — column is `String?`, not native Postgres enum. §7 rollback drama softened; concern is purely Zod-layer.
6. ✅ **Class-B "re-check anyway" was a dead-end** — `createFlightSchema` requires `lat`/`lon`/`tz`; re-checking guarantees a 400. Affordance dropped.
7. ✅ **Class-D chunk-atomicity** — `flightsBatch.ts` wraps all 20 rows in `prisma.$transaction`; chunks are all-or-nothing. UX behaviour clarified.
8. ✅ **API prefix `/api/v1/import/preview`** — was vague; now explicit.

Plus: malformed-Date/Time edge case added as the 9th golden-master test.

**Codex — post-implementation review (SCHEDULED):**

After implementation lands on `dev/v1-5-importers` and tests are green, submit cold (no chat context) to `codex exec`:
- `services/importPreview.ts`
- `lib/importers/fr24.ts`
- `lib/importers/genericCsv.ts`
- the new test files

Goal: catch bugs both Gemini and I missed. Surface findings to user before merge to `main`.

---

## 10 · Out of scope (deferred)

- **OpenFlights / App in the Air / FlightAware first-class adapters** — Generic-CSV-Wizard covers their use cases; first-class adapters slot in as v1.5.x patches if real demand arises (and we get representative samples).
- **Cruise-side equivalent importer** — needs `/cruises/batch` endpoint first; tracked under v2.
- **Boot-time backfill of new AeroDataBox fields** — lazy via existing scheduler is sufficient; explicit "Bulk historical refresh" UI from 1.4 covers the manual case.
- **Aircraft type / hull image rendering** — needs CC-BY-SA attribution UI which doesn't exist; defer.
- **Block-time analytics dashboard** — depends on `runwayDepartureTime` / `runwayArrivalTime` populated; data lands in v1.5, UI in v2.
- **Quality-tag / cargo / freshness filters in the dashboard** — same data-first-UI-later pattern.

---

## 11 · Open questions

None at design time. All clarifying questions resolved during brainstorming.

If implementation surfaces new ones (e.g., specific FR24 edge case not covered by the golden sample, ColumnMappingWizard UX corner cases), document them in PR description and ask before locking the answer.
