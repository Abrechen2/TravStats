# TravTrack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-user location provider (`none` | `travtrack` | `dawarich`) that decides where the Companion's recordings go and where TravStats reads positions from, and — in phase 2 — TravTrack itself: an optional, beta-gated location-history area inside the TravStats server that rebuilds Dawarich's core and hands TravStats suggestions through the inbox.

**Architecture:** TravTrack lives in the same server as TravStats, like TravPlan: `/track` in the web, `/travtrack/*` in the API, own tables and services, its own beta key, enabled per instance and per user. TravStats never writes TravTrack tables and TravTrack never writes confirmed TravStats entries; they talk through a `LocationProvider` interface (reads) and the inbox (suggestions). Dawarich stays a read-only external provider — nothing is ever written into or deleted from it, and a provider switch never moves, copies or deletes data.

**Tech Stack:** Server: Express + TypeScript, Prisma 7 / Postgres + PostGIS, Zod, Jest. Web: React + Vite, Zustand, react-i18next, Vitest. Companion (`/home/claude/projekte/TravStatsCompanion`): Expo 56 / React Native 0.85, expo-location + expo-task-manager, Jest (`jest-expo`, run from `app/`).

**Spec:** the owner-approved concept, prototype https://claude.ai/artifact/GVhWNpB9Ekqh1mJ8bbpobX (version 7, 2026-10-24). Its Codex rounds are recorded in the session scratchpad (`travtrack/codex-concept.md`, `travtrack/codex-amend.md`). The rules this plan implements, verbatim from the owner's decisions of 2026-10-24:

1. TravStats is the main function and works fully without TravTrack.
2. The provider decides where NEW recordings go and where reads come from. Switching moves, copies and deletes nothing; every track keeps its origin.
3. With TravTrack, flight and trip recording ALSO run through TravTrack (a segment linked to the entry). Only with no provider does the Companion offer its own flight/trip recording. With Dawarich the Companion records nothing; TravStats reads the flight/trip track from Dawarich for the entry's window.
4. Default: TravTrack + Companion for new users — only where TravTrack is unlocked; existing users are never switched.
5. Never write into Dawarich. No relay.
6. TravTrack suggests, TravStats decides (inbox). An accepted stay survives deletion of its history; open suggestions vanish with it.
7. First TravTrack beta: Companion only as source (no OwnTracks/Overland/GPX).
8. "Der Server weiß alles": the phone is a cache and a durable queue, never the only copy.

## Global Constraints

- Code, comments, commits, ADRs: English. Web and Companion copy: German first, English mirrored in the same change (`localeKeyParity.test.ts` on the web).
- Server: Prisma schema changes via `npx prisma migrate dev` in a throw-away clone DB, applied to the shared dev DB with `migrate deploy` only; `npm run check:drift` stays green. Data backfills may be appended to a generated migration.
- Every new endpoint: OpenAPI path + 200 response schema (`openapi.coverage.test.ts`, `openapi.responseSchema.test.ts`); every new router file assigned a family in `apiResponseShape.baseline.json` (bare, like `settings/*`).
- Every failure reaches the user as itself: stable error codes (`SCREAMING_SNAKE`), mapped to DE/EN copy; never a 200 fallback.
- No file over 800 lines (`check:size`). Prettier on the whole tree.
- Gates before any merge to `dev/travtrack`'s parent: the Build Checks in `CLAUDE.md` plus Codex review of the diff.
- Long-running branch `dev/travtrack` off `main`; `main` merged into it after every main release; never touch `backend/VERSION` / `CHANGELOG.md` there. Companion work on `feat/travtrack-p1` off `forgejo/main` of the Companion repo.
- Merging into `main` is the owner's release decision, asked separately.

## Review Focus

1. **Existing Dawarich user upgrades** — a user whose own Dawarich connection drives country days, stays and market visits today must see exactly the same behaviour after the migration (provider backfilled to `dawarich`). Pinned in Task S2 and S3.
2. **Recordings queued before a switch** — a trip recording queued on the phone while provider was `none` must still upload after the user switches to `dawarich`; the server never refuses a recording because of the provider. Pinned in S4 and C3.
3. **Old Companion against new server / new Companion against old server** — no `/location/capabilities` (404) means "legacy": the app behaves exactly like today. Pinned in C2.
4. **Dawarich chosen without an own connection** — refused with `DAWARICH_NOT_CONFIGURED`; a removed key leaves provider `dawarich` reported as `notConfigured`, never silently `none`. Pinned in S2 and S4.
5. **Flight inside a trip** — exactly one OS location task runs, and the trip track shows the flight window as a break, not a line. Pinned in C5.

---

## Phase 1 — Clean up, provider setting, the `none` path made safe

Delivers value with TravTrack absent: packing list, personal settings and exactly-once creates reach `main`; the provider setting exists and the Companion obeys it; the relay is gone for good.

### Task S0: Archive the stopped branch

**Files:** none (git only).

- [ ] **Step 1:** `git tag archive/companion-audit-relay forgejo/feat/companion-audit` and push the tag to forgejo only (`git push forgejo archive/companion-audit-relay`). Same in the Companion repo: `git tag archive/companion-audit-relay forgejo/fix/companion-audit`, push to forgejo.
- [ ] **Step 2:** Verify both tags resolve on forgejo (`git ls-remote forgejo refs/tags/archive/*`). The branches themselves are deleted only after Phase 1 is merged (owner's call).

### Task S1: Salvage the provider-independent server work

The pieces of `feat/companion-audit` that do not touch location: packing lists, home place, passport expiry, exactly-once creates on seven routes, the cron table split. Pick them, do not merge the branch.

**Files (from the branch, as of 43b0b7ed0):**
- Migration: `backend/prisma/migrations/20261023180000_companion_data/migration.sql` (keep its timestamp; it sorts after main's latest `20261023140047_rail_transit_mode`).
- `backend/src/routes/trips/tripPacking.ts`, `backend/src/routes/settings/personal.ts`, `backend/src/schemas/companionData.ts`, `backend/src/services/trip/mergeTripRelations.ts`, `backend/src/services/openapi/paths/companionData.ts`
- clientRef: `backend/src/services/sync/clientRef.ts` (widened `ClientRefKind`), `backend/src/routes/flights/create.ts` (split out, with `SHARE_TX_TIMEOUT_MS`), the clientRef parts of `routes/{cruises,places,lodging,lodging/stays,trips/tripPhotos}.ts`, `services/{cruise/createCruise,lodging/createLodging,lodging/stayWrites}.ts`
- `backend/src/jobs/cronJobs.ts` WITHOUT the `location_transfer` row (branch :87-91) and WITHOUT the `snapshotLocationSources` boot call (:60-61); `backend/src/index.ts` accordingly
- `backend/src/routes/trips/resolveTrip.ts` (`TRIP_NOT_FOUND`)
- Tests: `tripPacking.test.ts`, `settings.personal.test.ts`, `services/__tests__/tripMergePacking.test.ts`, `*.clientRef.test.ts` (cruises, flights, lodging, places, tripPhotos), `__tests__/openapi.createClientRef.test.ts`, `propagate.txTimeout.test.ts`

**Interfaces:**
- Produces: `GET/PUT /trips/:id/packing`, `GET/PUT /settings/personal` exactly as on the branch (the Companion branch already calls them).

- [ ] **Step 1:** Cherry-pick `d3cc0a548` (companion data) and `c2cb4b298` (clientRef on six routes) onto `dev/travtrack`; resolve conflicts against main.
- [ ] **Step 2:** Port by hand the independent hunks of the mixed commits: tripPhoto clientRef from `965b2c876`; packing-merge row locks + nothing dropped from `a976e3b81`; packing item ids ≤ 64 chars from `a4e92c019`; `SHARE_TX_TIMEOUT_MS` from `a7223a53c`; packing-id uniqueness loop from `bd4724670`; `TRIP_NOT_FOUND` from `a976e3b81`. Use `git show <hash> -- <file>` per file; no hunk that mentions `transfer`, `relay`, `remote`, `locationSource` or `LocationReader`.
- [ ] **Step 3:** Cherry-pick `582f6e184` (cron table split) and delete the `location_transfer` job and the boot snapshot from it.
- [ ] **Step 4:** Run `cd backend && npx jest tripPacking settings.personal tripMergePacking clientRef openapi propagate.txTimeout apiResponseShape --forceExit`. Expected: all pass.
- [ ] **Step 5:** `grep -rn "locationTransfer\|dawarichWriter\|remoteObligation\|relay" backend/src` → no hits. Commit `feat(companion): packing lists, home place, passport expiry and exactly-once creates on the server`.

### Task S2: The provider setting

**Files:**
- Modify: `backend/prisma/schema.prisma` (`UserSettings`, next to `dawarichApiKey` :889)
- Create: migration `<ts>_location_provider` (generated), `backend/src/services/locationProvider/provider.ts`, `backend/src/services/locationProvider/__tests__/provider.test.ts`
- Create: `backend/src/routes/settings/locationProvider.ts`, `backend/src/schemas/locationProvider.ts`, `backend/src/services/openapi/paths/locationProvider.ts`; register in `routes/settings/index.ts`, `paths/index.ts`, `apiResponseShape.baseline.json` (bare)
- Test: `backend/src/routes/__tests__/locationProvider.test.ts`

**Schema:** `locationProvider String @default("none") @map("location_provider")` (values `none|travtrack|dawarich`, CHECK constraint appended to the migration) and `locationProviderRev Int @default(0) @map("location_provider_rev")`. Backfill appended to the migration:
`UPDATE user_settings SET location_provider = 'dawarich' WHERE dawarich_base_url IS NOT NULL AND dawarich_api_key IS NOT NULL;`
(Only the user tier — unattended Dawarich features already use the user tier alone, see `dawarichResolver.ts` header; so nobody's behaviour changes.)

**Interfaces:**
- Produces (`provider.ts`):
  - `type LocationProviderKind = "none" | "travtrack" | "dawarich"`
  - `type ProviderStatus = "ok" | "notConfigured" | "unavailable"`
  - `getLocationProvider(userId: string): Promise<{ kind: LocationProviderKind; rev: number; status: ProviderStatus }>` — no settings row → `{kind:"none", rev:0, status:"ok"}`; `dawarich` without a user-tier connection → `status:"notConfigured"`; `travtrack` while `travTrackAvailable(userId)` is false → `status:"unavailable"`.
  - `setLocationProvider(userId: string, kind: LocationProviderKind): Promise<{ kind; rev }>` — bumps `rev`; throws `AppError(409, "DAWARICH_NOT_CONFIGURED")` without a user-tier connection, `AppError(409, "TRAVTRACK_UNAVAILABLE")` while TravTrack is not available. Moves, copies, deletes nothing.
  - `travTrackAvailable(userId: string): Promise<boolean>` — Phase 1: always `false` (TravTrack does not exist yet); Task T1 replaces the body.
  - `providerIs(userId: string, kind: LocationProviderKind): Promise<boolean>` — `kind` matches AND `status === "ok"`.
- Routes: `GET /settings/location-provider` → `{ kind, rev, status, choices: { none: true, travtrack: boolean, dawarich: boolean } }`; `PUT /settings/location-provider` `{ kind }` (write scope).

- [ ] **Step 1: Write the failing tests** — `provider.test.ts`: "a user without settings has provider none"; "dawarich without an own connection is refused with DAWARICH_NOT_CONFIGURED"; "dawarich with only the admin-global connection is refused" (privacy boundary); "travtrack is refused with TRAVTRACK_UNAVAILABLE in phase 1"; "a switch bumps rev and leaves flight_tracks, trip_recording_batches, trip_route_tracks and cruise_tracks row counts unchanged"; "a removed own key reports dawarich / notConfigured, not none". Route test: GET shape, PUT 409 codes, PUT needs write scope (read-only PAT → 403).
- [ ] **Step 2:** Run `npx jest provider locationProvider --forceExit` → FAIL (module missing).
- [ ] **Step 3:** Generate the migration in a throw-away clone DB, append CHECK + backfill, implement `provider.ts`, schemas, routes, OpenAPI.
- [ ] **Step 4:** Migration test `backend/src/__tests__/migration.locationProvider.test.ts` (template: `migration.loyaltyMemberships.test.ts`): rows in the OLD shape — one user with own Dawarich URL+key, one with URL only, one with none — replay the migration, assert `dawarich`, `none`, `none`.
- [ ] **Step 5:** Run the tests + `npm run check:drift` → PASS. Commit `feat(location): a per-user location provider — none, TravTrack or Dawarich`.

### Task S3: Dawarich's automatic features follow the provider

Today they run for anyone with an own Dawarich connection. From now on they run when `providerIs(userId, "dawarich")`. After the S2 backfill that is the same set of users. Explicit pulls a person presses (tour/cruise "pull from Dawarich", stay "scan now") stay available whenever `getDawarichConnection` resolves — they are a one-off copy into an entry, like a GPX upload.

**Files:**
- Modify: `backend/src/jobs/dawarichCountryDaySweepScheduler.ts`, `backend/src/jobs/dawarichStayScheduler.ts`, the market-visit job entry in `backend/src/services/dawarich/marketVisits/integration.ts`
- Test: the existing `jobs/__tests__/dawarichCountryDaySweepScheduler.test.ts` and the stay-scheduler test, extended

**Interfaces:** Consumes `providerIs` (S2).

- [ ] **Step 1: Failing tests:** "the nightly sweep skips a user whose provider is none even with an own connection"; "the sweep runs for provider dawarich exactly as before" (existing assertions unchanged); same pair for the stay scan and market visits.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Add the `providerIs` filter where each job selects its users (in the query, not after loading). **Step 4:** Run → PASS.
- [ ] **Step 5: Web hint** — `frontend/src/components/Settings/DawarichConnectionCard.tsx`: after a successful save while provider is `none`, show "Dawarich ist verbunden. Als Standortquelle verwenden?" / "Dawarich is connected. Use it as your location source?" with a button that PUTs `dawarich`. Vitest: the hint appears after save with provider none, not with provider dawarich, and a 409 shows the mapped copy.
- [ ] **Step 6:** Commit `feat(dawarich): automatic Dawarich features follow the chosen location provider`.

### Task S4: Capabilities for the Companion

**Files:**
- Create: `backend/src/routes/locationCapabilities.ts` (mounted at `/api/v1/location/capabilities` in `routes/mounts.ts`, `authenticate` only, like `GET /travplan/capabilities` in `routes/travplan.ts:42-56`), OpenAPI path, baseline entry
- Test: `backend/src/routes/__tests__/locationCapabilities.test.ts`

**Interfaces:**
- Produces `GET /location/capabilities` →
  ```ts
  {
    version: 1,
    provider: { kind: LocationProviderKind, rev: number, status: ProviderStatus },
    capture: {
      flight: boolean,   // kind === "none" && flightLiveTrackingEnabled(user)
      trip: boolean,     // kind === "none" && tripRecordingEnabled(user)
      everyday: boolean, // kind === "travtrack" && status === "ok"  (false in phase 1)
      modes: Array<"off" | "trips" | "everyday">  // [] for none/dawarich in phase 1
    },
    travTrack: { offered: boolean, enabled: boolean }
  }
  ```
- Rule pinned here: `POST /flights/:id/track` and `POST /trips/:id/recording` do NOT consult the provider. A recording queued before a switch keeps its target and is accepted.

- [ ] **Step 1: Failing tests:** shape for each provider; "provider dawarich → capture.flight and capture.trip false"; "a trip recording uploaded while provider is dawarich is still accepted (201)"; "a flight track uploaded while provider is dawarich is still accepted"; read-only PAT may call capabilities.
- [ ] **Step 2–4:** Run → FAIL, implement, run → PASS.
- [ ] **Step 5:** Commit `feat(location): tell the Companion what to record`.

### Task S5: Web — Settings → Standort

**Files:**
- Create: `frontend/src/components/Settings/LocationProviderSection.tsx` (+ test), `frontend/src/lib/api/locationProvider.ts`
- Modify: `frontend/src/pages/Settings/settingsModel.ts` (the "location" group, above `TripRecordingSection`), `sectionLabels.ts`, `SettingsSectionSwitch.tsx`, `i18n/resources/{de,en}/settings.json`

**Behaviour:** three radio cards as in the prototype board "Stats-Quelle": Keine / TravTrack / Dawarich. TravTrack is shown only when `choices.travtrack` is true (phase 1: hidden). Dawarich is disabled with a link to the connection card when `choices.dawarich` is false. Below: "Was das bedeutet" bullets per choice (copy from the prototype, Stats-Quelle.dc.html), and the line "Ein Wechsel ändert nur, was ab jetzt aufgezeichnet und gelesen wird. Es wird nichts verschoben, kopiert oder gelöscht." / "Switching only changes what is recorded and read from now on. Nothing is moved, copied or deleted." `notConfigured` shows a warning, not a silent fallback.

- [ ] **Step 1: Failing Vitest:** renders the stored choice; PUT on pick; 409 `DAWARICH_NOT_CONFIGURED` shows its mapped copy and keeps the old choice selected; TravTrack card absent when `choices.travtrack` is false; `notConfigured` warning.
- [ ] **Step 2–4:** FAIL → implement → PASS; `localeKeyParity` green.
- [ ] **Step 5:** Commit `feat(settings): choose the location source on the web`.

### Task C1: Companion — salvage `fix/companion-audit` without the relay display

Repo `/home/claude/projekte/TravStatsCompanion`. Local `main` is stale (94a441a8); base on `forgejo/main` (bb7c5704).

**Files to remove after the merge** (from the survey of `e63a6610`):
`app/src/lib/location/source.ts`, `app/src/components/location/LocationSourceStatus.tsx`, their tests (`components/location/__tests__/location-source-status.test.tsx`, `lib/location/__tests__/source.test.ts`), `getLocationSummarySource` in `app/src/server/api/location.ts`, `STORE_KEYS.locationSource` (`store.ts`, `account-wipe.ts`), the `source.*` keys and relay sentences in `components/location/copy.ts`, the relay paragraphs in `product/privacy.md`, the `<LocationSourceStatus/>` line in `app/settings/location.tsx`. `deleteTripRecordingOnServer` stops returning `{dawarichPending}`.

- [ ] **Step 1:** `git fetch forgejo && git checkout -b feat/travtrack-p1 forgejo/main && git merge --no-ff forgejo/fix/companion-audit`.
- [ ] **Step 2:** Remove the files and keys above. `grep -rni "relay\|dawarichPending\|locationSource" app/src product` → no hits.
- [ ] **Step 3:** Amend `adrs/0014-location-history-goes-to-the-server.md`: drop "Dawarich (relay)" as a later phase; point to ADR 0015 (Task C5).
- [ ] **Step 4:** `cd app && npx tsc --noEmit && npm test` → PASS. Commit `fix(location): drop the Dawarich relay display`.

### Task C2: Companion — read the capabilities

**Files:**
- Create: `app/src/lib/location/capabilities.ts` (+ `__tests__/capabilities.test.ts`), `getLocationCapabilities` in `app/src/server/api/location.ts`
- Modify: `app/src/lib/store.ts` (`STORE_KEYS.locationCapabilities`, wiped by `account-wipe.ts` and unpair)

**Interfaces:**
- Produces:
  - `type LocationCapabilities` = the S4 response, plus `{ legacy: true }` variant
  - `readLocationCapabilities(): Promise<LocationCapabilities>` — cached per server + account; refreshed on app foreground and when the location settings screen opens; 404 → `{ legacy: true }`; network error → last cached value, or `legacy` if none.
  - `captureAllowed(caps: LocationCapabilities, kind: "flight" | "trip" | "everyday"): boolean` — `legacy` → today's behaviour (`flight`/`trip` follow the existing server switches `liveTracking` / `tripRecording` from `lib/server-switches.ts`; `everyday` false).

- [ ] **Step 1: Failing tests:** 404 → legacy and `captureAllowed(legacy,"trip")` follows `tripRecording`; provider dawarich → all false; network error keeps the cached value; unpair wipes the cache; another account's cache is never read.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(location): read what the server wants recorded`.

### Task C3: Companion — the recorders obey the provider

**Files:**
- Modify: `app/src/components/system/FlightTrackSync.tsx` (:170), `app/src/components/system/TripTrackSync.tsx` (:106), `app/src/lib/flight-track/background.ts` (`backgroundPlan` :110), `app/src/lib/trip-track/background.ts` (`tripRecorderPlan` :130), `app/src/lib/flight-track/record-fix.ts` (`recordFlightFixes` :43)
- Tests: the existing `__tests__/background.test.ts` of both, `record-fix` test

**Rules:**
- `backgroundPlan` / `tripRecorderPlan` take `captureAllowed(...)` as an input; not allowed → `'stop'` (running) or no start.
- Nothing already queued is discarded on a switch; `uploadLocationQueueOnce` keeps sending envelopes to their frozen target.
- `recordFlightFixes` queues raw flight fixes only when `captureAllowed(caps, "everyday")` (i.e. TravTrack); otherwise it is a no-op and the flight track goes through `POST /flights/:id/track` as on main. (Prevents raw fixes waiting forever for a `/location/points` route that does not exist.)

- [ ] **Step 1: Failing tests:** "provider dawarich stops a running trip recorder and starts none"; "a trip envelope queued before the switch is still uploaded after it"; "raw flight fixes are not queued with provider none"; "legacy server: plans unchanged from today" (existing cases stay green).
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(location): record only what the chosen source asks for`.

### Task C4: Companion — settings screen by provider

**Files:** `app/src/app/settings/location.tsx`, `app/src/components/location/copy.ts` (DE + EN), screen test.

**Behaviour** (prototype board "Companion"):
- `none` or `legacy`: today's screen — "Flüge und Reisen" with flight and trip switches, upload status, recordings list, privacy zones.
- `dawarich`: no recording switches; text "Dein Server liest den Verlauf aus deinem Dawarich, auch für Flüge und Reisen. Aufgezeichnet wird mit der Dawarich-App; diese App zeichnet dann nichts auf." / "Your server reads your history from your Dawarich, flights and trips included. Record with the Dawarich app; this app records nothing then." Upload status stays visible while anything is still queued.
- `travtrack`: not reachable in phase 1 (capability false).

- [ ] **Step 1: Failing tests** for the three states, including "queued uploads still shown under dawarich".
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(settings): the location screen follows the server's source`.

### Task C5: Companion — one capture coordinator

Today `travstats.flight-track` and `travstats.trip-track` are two OS tasks; during a flight inside a trip both run (two Android notifications). Replace them with one.

**Files:**
- Create: `app/src/lib/location/coordinator.ts` (+ tests) — owns the single `TaskManager.defineTask(CAPTURE_TASK)` with `CAPTURE_TASK = 'travstats.capture'`, the single start/stop, and the rate choice.
- Create: `app/src/components/system/CaptureSync.tsx` replacing the recorder halves of `FlightTrackSync` and `TripTrackSync` in `app/src/app/_layout.tsx`. The flight-track UPLOAD task and the push task are untouched.
- Modify: `flight-track/background.ts` and `trip-track/background.ts` keep their plan functions (pure) and their location handlers; the coordinator calls them. Migration on first start: stop and unregister the two old task names if registered.
- Create: `adrs/0015-one-capture-path-by-location-provider.md`, index in `adrs/README.md`.

**Interfaces:**
- `type CapturePurpose = "flight" | "trip" | "everyday"`
- `capturePlan(input: { flight: FlightPlanInput | null; trip: TripPlanInput | null; caps: LocationCapabilities; now: number }): { run: boolean; options: LocationTaskOptions; purposes: CapturePurpose[] }` — pure. Highest demand wins: flight (High, 20 s, `ActivityType.Airborne`) > trip fine (High, 100 m, 1 min) > trip coarse (Balanced, 500 m, 5 min). Revive of a silent task (`RECORDER_SILENT_MS`) moves here.
- `handleCaptureLocations(locations, purposes)` dispatches each fix to `handleBackgroundLocations` (flight) and/or `handleTripLocations` (trip); the trip handler keeps marking the flight window as a break.

- [ ] **Step 1: Failing tests:** "a flight inside a trip runs exactly one task with flight options"; "after landing the task continues with trip options, not stopped and restarted twice"; "the trip track gets a break for the flight window"; "the old task names are unregistered on first start"; "dawarich → run false".
- [ ] **Step 2–4:** FAIL → implement → PASS; run the time-zone variant `npm run test:time-zones`.
- [ ] **Step 5:** Commit `feat(location): one capture task for flights and trips`.
- [ ] **Step 6: Real phones.** Android + iPhone, a short trip with a flight-mode simulation: one notification, track arrives on the server. Owner does the field test; record results in ADR 0015.

### Phase 1 exit

- [ ] Server gates (Build Checks) green on `dev/travtrack`; Companion `tsc` + `npm test` green.
- [ ] Codex review of both diffs; findings fixed.
- [ ] Ask the owner, as a single question, whether phase 1 goes to `main` / an RC.

---

## Phase 2 — TravTrack beta (Companion as the only source)

Planned at task level; each task gets its test list written out when phase 1 has landed (the S2/S4 interfaces may still move).

- **T1 Gate.** Beta key `travTrack` in `frontend/src/config/betaFeatures.ts` (why + returnsWhen). Server: `services/travtrack/availability.ts` (`travTrackOffered()` = `betaFeaturesEnabled`) + `travtrack_config` row (`enabled`, env `TRAVTRACK_ENABLED` fallback), pattern of `services/travplan/{availability,store}.ts`. `GET /travtrack/capabilities` answers always; every other `/travtrack/*` route refuses with 403 `TRAVTRACK_DISABLED`. `travTrackAvailable()` (S2) gets its real body.
- **T2 Point store.** Port the generic migrations from the archive tag — `location_points` (without the relay columns), `location_uploads`, `location_deleted_ranges`, `location_privacy_zones`, `seq` — as ONE new migration with a timestamp after main's latest, renamed to `travtrack_*` tables. Add to `travtrack_points`: `purpose` (`everyday|flight|trip`), `entry_kind` (`flight|trip|null`), `entry_id`. Port `classify.ts`, `ingest.ts`, `zones.ts` without `remoteObligation`/`relayConnection`/`remoteOnly`. Tests from the branch's `locationPoints.test.ts` (minus the "what a delete still owes Dawarich" block) and `locationZones.test.ts`.
- **T3 Ingest route.** `POST /travtrack/points` (device token only, idempotent `uploadId`, zone → deleted range → duplicate order), `GET /travtrack/points`, `GET /travtrack/summary`, `DELETE /travtrack/points` (removes points, segment geometry, caches, unaccepted suggestions; leaves tombstones so late uploads cannot restore; flights/trips stay, their evidence marked deleted), zones CRUD.
- **T4 Provider reads.** `LocationProvider` interface in `services/locationProvider/types.ts` with a neutral observation type (not the Dawarich alias): `readPoints(window, cursor?) → { points, next, coverage: "complete" | "truncated" | "unreachable" }`, `getCoverage(window)`. Adapters `travtrackProvider` and `dawarichProvider` (wrapping today's client). Callers that read Dawarich today (tour/cruise pulls, stays, country days, market visits) go through it; truncation is shown, never treated as complete.
- **T5 Entry tracks from TravTrack.** Flight and trip pages read their track via the provider for the entry's window when the entry has no own `FlightTrack` / `TripRecordingBatch`; the response carries `origin: "travstats" | "travtrack" | "dawarich"` and `coverage`. Existing own recordings keep showing as "TravStats-Aufzeichnung" after any switch; another source is an explicit extra view, never a silent swap. Privacy-zone gaps stay gaps (no line through them).
- **T6 Web `/track`.** Day view as the prototype board "Track-Tag": map, timeline labelled from TravStats context (flights, trips, home place), coverage bar, privacy zones, export (GPX + JSON with origin and coverage), delete by range. Domain-gated menu entry "Track".
- **T7 Backup/export/share.** All-data export and backup include TravTrack points, zones, tombstones. A shared trip carries a filtered, versioned track snapshot only, revocable and removed with its history.
- **T8 Default for new accounts.** On account creation: provider `travtrack` when `travTrackAvailable`, else `none`. Unlocking the beta later never changes existing accounts.
- **C6 Companion modes.** With `capture.everyday`: modes Aus / Flug & Reise / Alltag (prototype board "Companion"). The coordinator (C5) gains the everyday rate (coarse) and raises precision during a flight or trip. `QueuedPoint` gains `purpose` and `entry` and sends to `POST /travtrack/points`; trip/flight envelopes queued under `none` keep their old target. Privacy zones on the device; stale zones → conservative, skipped intervals reported.
- **C7 Field test** on real phones before everyday recording is advertised (Android watchdog measurement from the archived P0 spec).

## Phase 3 — TravTrack helps TravStats

Stay and country-day suggestions from TravTrack into the existing inbox (same cards as Dawarich stays, `EvidenceSuggested` with id, provider + rev, window, algorithm version; accept is idempotent and re-checks the evidence; an accepted entry never counts as evidence for itself); missing-journey suggestions; GPX import; OwnTracks and Overland ingest.

## Phase 4 — later

Erkundet map (fog of war), Zuletzt gesehen, monthly values, journey/trip inference, TravPlan plan-vs-actual, Dawarich history import as an explicit copy with a completeness report.
