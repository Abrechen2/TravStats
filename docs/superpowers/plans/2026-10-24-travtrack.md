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
6. **First contact during an outage** — a new Companion that cannot reach `/location/capabilities` and has no cached answer starts nothing new (it does not fall back to legacy capture), keeps an already running recorder running, and retries. Pinned in C2.

Phase 2:

7. **TravTrack points survive a switch** — points the phone queued for TravTrack are accepted while the instance offers TravTrack, whatever the account's provider is by then; `403 TRAVTRACK_DISABLED` keeps them on the phone. Envelopes frozen for `/trips/:id/recording` keep that target. Pinned in T3 and C6.
8. **One fix, two entries** — a fix the flight and the trip recorder both hand over is one point with two links; a duplicate upload adds a missing link and never drops one; no entry ever has both an own track and TravTrack points for the same recording (`sink` frozen at arm time). Pinned in T2 and C6.
9. **Delete is final** — a range delete removes points, links, gaps and overlapping share snapshots, leaves a tombstone a late upload cannot cross, and leaves flights and trips standing. Pinned in T2, T3, T7.
10. **Privacy zones** — a fix inside one never leaves the phone (no zone list yet → held, not sent); ingest drops it again; no line is drawn through a zone, and no coverage state, gap or export reveals one. Pinned in T2, T5, T6, C6.
11. **Dawarich users at the flip** — recording stops in the same commit that shows Dawarich tracks on flight and trip pages; their own earlier recordings still show as "TravStats-Aufzeichnung"; an unreachable Dawarich says so and never hides an own recording. Pinned in T5.
12. **A phase-1 Companion against a phase-2 server** — it ignores `capture.sink`, so under provider `travtrack` it records flights and trips through the entry routes as before (true flags, own uploaders). Accepted: the server is still the record and nothing is doubled. Pinned in T5 (capabilities stay version 1, additive).
13. **Stays and country days do not move yet** — they keep their direct Dawarich reads and S3's selection in phase 2 (T4); a TravTrack user gets no derived suggestion until phase 3.
14. **Open for the owner:** TravTrack switched off by the admin while an account holds TravTrack data — every route but capabilities answers 403, so the data stays (and is in the export and backup, T7) but cannot be viewed or deleted until TravTrack is on again. Ask before T3 whether `GET /travtrack/summary` and `DELETE /travtrack/points` should stay open in that state.

**Sequencing rule (Codex, 2026-10-24):** "Dawarich → the Companion records nothing" takes effect only together with the reads that replace it (T5). In phase 1 a `dawarich` user keeps today's flight and trip recording.

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
- `backend/src/jobs/cronJobs.ts` WITHOUT the `location_transfer` row (branch :87-91) and WITHOUT the `snapshotLocationSources` boot block (~:58-67); `backend/src/index.ts` accordingly
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
  - `setLocationProvider(userId: string, kind: LocationProviderKind): Promise<{ kind; rev }>` — bumps `rev`; throws `new AppError(<message>, 409, "DAWARICH_NOT_CONFIGURED")` without a user-tier connection, `new AppError(<message>, 409, "TRAVTRACK_UNAVAILABLE")` while TravTrack is not available (constructor is `(message, statusCode, code)`; add both codes to the closed `ApiErrorCode` union). Moves, copies, deletes nothing.
  - `travTrackAvailable(userId: string): Promise<boolean>` — instance availability for this account (instance beta + config, not a demo user). Phase 1: always `false` (TravTrack does not exist yet); Task T1 replaces the body. Per-user activation IS choosing provider `travtrack`; there is no second per-user switch.
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
- Modify: `backend/src/jobs/dawarichCountryDaySweepScheduler.ts`, `backend/src/jobs/dawarichStayScheduler.ts` and its scheduled path in `backend/src/services/dawarich/stays/scan.ts` (market visits run inside the stay scan; `marketVisits/integration.ts` has no job). Explicit "scan now" keeps working regardless of provider.
- Test: the existing `jobs/__tests__/dawarichCountryDaySweepScheduler.test.ts` and the stay-scheduler test, extended

**Interfaces:** Consumes `providerIs` (S2).

- [ ] **Step 1: Failing tests:** "the nightly sweep skips a user whose provider is none even with an own connection"; "the sweep runs for provider dawarich exactly as before" (existing assertions unchanged); same pair for the scheduled stay scan (which carries market visits); "an explicit scan now by a provider-none user with an own connection still runs".
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
      flight: boolean,   // phase 1: kind !== "travtrack" && flightLiveTrackingEnabled(user)
                         // (dawarich keeps recording until T5 reads Dawarich tracks;
                         //  T5 changes it to kind === "none" || kind === "travtrack")
      trip: boolean,     // same rule with tripRecordingEnabled(user)
      everyday: boolean, // kind === "travtrack" && status === "ok"  (false in phase 1)
      modes: Array<"off" | "trips" | "everyday">  // [] for none/dawarich in phase 1
    },
    travTrack: { offered: boolean, enabled: boolean }
  }
  ```
- Rule pinned here: `POST /flights/:id/track` and `POST /trips/:id/recording` do NOT consult the provider. A recording queued before a switch keeps its target and is accepted.

- [ ] **Step 1: Failing tests:** shape for each provider; "phase 1: provider dawarich still allows flight and trip capture"; "a trip recording uploaded while provider is dawarich is still accepted (201)"; "a flight track uploaded while provider is dawarich is still accepted"; read-only PAT may call capabilities.
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
`app/src/lib/location/source.ts`, `app/src/components/location/LocationSourceStatus.tsx`, their tests (`components/location/__tests__/location-source-status.test.tsx`, `lib/location/__tests__/source.test.ts`), `getLocationSummarySource` in `app/src/server/api/location.ts`, `STORE_KEYS.locationSource` (`store.ts`, `account-wipe.ts`), the `source.*` keys and relay sentences in `components/location/copy.ts`, the relay paragraphs in `product/privacy.md`, the `<LocationSourceStatus/>` line in `app/src/app/settings/location.tsx`. Privacy zones (`PrivacyZones.tsx`, `/location/zones`) stay in the code but are shown only when `caps.travTrack.enabled` (C4) — the phase-1 server has no zone API, and zones kept only on the phone would break rule 8. `deleteTripRecordingOnServer` stops returning `{dawarichPending}` — update its consumer `lib/trip-track/store.ts` (~:335), the `EverywhereDeletion` union and their tests/UI. Review every removal against `ae4419df` (the survey of `e63a6610` predates three later commits, including the account-isolation and migration fixes).

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
  - `readLocationCapabilities(): Promise<LocationCapabilities | { unknown: true }>` — cached per server + account; refreshed on app foreground and when the location settings screen opens; a confirmed 404 → `{ legacy: true }`; network error → last cached value, or `{ unknown: true }` if none. `unknown` starts nothing new, keeps a running recorder on its current plan, and retries.
  - `captureAllowed(caps: LocationCapabilities, kind: "flight" | "trip" | "everyday"): boolean` — `legacy` → today's behaviour (`flight`/`trip` follow the existing server switches `liveTracking` / `tripRecording` from `lib/server-switches.ts`; `everyday` false).

- [ ] **Step 1: Failing tests:** 404 → legacy and `captureAllowed(legacy,"trip")` follows `tripRecording`; "first contact during an outage → unknown, nothing new starts"; network error keeps the cached value; unpair wipes the cache; another account's cache is never read.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(location): read what the server wants recorded`.

### Task C3: Companion — the recorders obey the provider

**Files:**
- Modify: `app/src/components/system/FlightTrackSync.tsx` (:170), `app/src/components/system/TripTrackSync.tsx` (:106), `app/src/lib/flight-track/background.ts` (`backgroundPlan` :110), `app/src/lib/trip-track/background.ts` (`tripRecorderPlan` :130), `app/src/lib/flight-track/record-fix.ts` (`recordFlightFixes` :43)
- Tests: the existing `__tests__/background.test.ts` of both, `record-fix` test

**Rules:**
- `backgroundPlan` / `tripRecorderPlan` take `captureAllowed(...)` as an input; not allowed → `'stop'` (running) or no start.
- Nothing already queued is discarded on a switch; `uploadLocationQueueOnce` keeps sending envelopes to their frozen target.
- Gate ONLY the raw-history half: `recordFlightFixes` keeps calling `recordTrackPoint()` (the flight track that `POST /flights/:id/track` uploads), and queues raw fixes into the location queue only when `captureAllowed(caps, "everyday")`. The same gate goes into `flight-track/raw-backfill.ts` (`backfillLegacyFlightFixes`, called by `location/upload.ts` every run) and the held-fix path (`location/hold.ts`). `{kind:'points'}` envelopes already queued stay queued (never dropped) and wait for a server that accepts them.

- [ ] **Step 1: Failing tests:** "capture.trip false stops a running trip recorder and starts none"; "a trip envelope queued before the switch is still uploaded after it"; "provider none: the flight track is still recorded and uploaded, raw fixes are not queued"; "the legacy backfill queues nothing with provider none"; "legacy server: plans unchanged from today" (existing cases stay green).
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(location): record only what the chosen source asks for`.

### Task C4: Companion — settings screen by provider

**Files:** `app/src/app/settings/location.tsx`, `app/src/components/location/copy.ts` (DE + EN), screen test.

**Behaviour** (prototype board "Companion"):
- `none`, `legacy`, and in phase 1 also `dawarich`: today's screen — "Flüge und Reisen" with flight and trip switches, upload status, recordings list; no privacy zones (see C1).
- `dawarich` from T5 on: no recording switches; text "Dein Server liest den Verlauf aus deinem Dawarich, auch für Flüge und Reisen. Aufgezeichnet wird mit der Dawarich-App; diese App zeichnet dann nichts auf." / "Your server reads your history from your Dawarich, flights and trips included. Record with the Dawarich app; this app records nothing then." Upload status stays visible while anything is still queued.
- `travtrack`: not reachable in phase 1 (capability false).

- [ ] **Step 1: Failing tests** for the states, including "queued uploads still shown under dawarich" and "no privacy-zone section while travTrack is not enabled".
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(settings): the location screen follows the server's source`.

### Task C5: Companion — one capture coordinator

Today `travstats.flight-track` and `travstats.trip-track` are two OS tasks; during a flight inside a trip both run (two Android notifications). Replace them with one.

**Files:**
- Create: `app/src/lib/location/coordinator.ts` (+ tests) — owns the single `TaskManager.defineTask(CAPTURE_TASK)` with `CAPTURE_TASK = 'travstats.capture'`, the single start/stop, and the rate choice.
- Create: `app/src/components/system/CaptureSync.tsx` replacing the recorder halves of `FlightTrackSync` and `TripTrackSync` in `app/src/app/_layout.tsx`. The flight-track UPLOAD task and the push task are untouched.
- Modify: `flight-track/background.ts` and `trip-track/background.ts` keep their plan functions (pure). Their location handlers are split: the PROCESSING half (thin, record, queue, mark the flight window as a break, extend the flight window, update armed state, headless expiry decisions) stays and is called by the coordinator; the LIFECYCLE half (`stopTripRecorder()` on pause/disable/expiry, the flight self-stops) moves into the coordinator, which decides from `capturePlan`. Migration on first start: stop and unregister the two old task names if registered.
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

Written out on 2026-10-24 against what Phase 1 built on `dev/travtrack` (`services/locationProvider/{provider,capabilities,kinds}.ts`, `routes/settings/locationProvider.ts`, `routes/locationCapabilities.ts`, the S3 provider gates, `LocationProviderSection` + `locationProviderStore`) and on the Companion's `feat/travtrack-p1` (`lib/location/{capabilities,coordinator,capture-plan,queue,upload,collect,route}.ts`, `adrs/0015`).

**Porting source.** The archived branch, tag `archive/companion-audit-relay` (= `43b0b7ed0`), read with `git show archive/companion-audit-relay:<path>`. Port, never cherry-pick: every file loses `remoteObligation`, `relayConnection`, `remoteOnly`, `remotePending`, `remoteConnection`, relay receipts, `kickRelay`, `transfer*`, `deleteDawarichRange` and `locationSource/resolve`. After each server task: `grep -rn "relay\|remoteObligation\|remoteOnly\|locationSource\|transfer" backend/src/services/travtrack backend/src/routes/travtrack*` → no hits. Field notes worth keeping are in the tag's `docs/superpowers/specs/2026-10-20-native-location-history.md` (§2 Dawarich v1.16 feature map, §4.1 P0 Android measurements, §10 the four P1 rules).

**Order.** T1–T8 are server/web and each is testable on its own; the Companion tasks consume them: C6 needs T1–T3 (gate, points, zones), C7 needs T5 (the capability flip), C8 is the field test. Within the server, T5 needs T4; T6 needs T3 + T5; T7 needs T3; T8 needs only T1.

### Task T1: One migration and the instance gate

**Files:**
- Modify: `backend/prisma/schema.prisma` (all TravTrack models at once, next to `TravelPlanConfig`; back-relations on `User`)
- Create: migration `<ts>_travtrack` (generated in a throw-away clone DB; `<ts>` after `20261024171325_location_provider`), `backend/src/__tests__/migration.travtrack.test.ts`
- Create: `backend/src/services/travtrack/availability.ts`, `backend/src/services/travtrack/config.ts`, `backend/src/routes/travtrack.ts` (router shell + gate + capabilities + admin config), `backend/src/services/openapi/paths/travtrack.ts`; register in `routes/mounts.ts` (`{ id: "travtrack", base: "/api/v1" }`), `paths/index.ts`, `apiResponseShape.baseline.json` (bare)
- Modify: `backend/src/services/locationProvider/provider.ts` (`travTrackAvailable` body), `middleware/errorHandler.ts` (`TRAVTRACK_DISABLED`, `TRAVTRACK_DEVICE_REQUIRED` into `ApiErrorCode`)
- Modify (web): `frontend/src/config/betaFeatures.ts` (key `travTrack`), Admin → Instanz switch for `travtrack_config.enabled` (next to the beta switch, `pages/Admin/adminSections.ts`), `frontend/src/lib/api/travtrack.ts` (capabilities + config)
- Tests: `backend/src/services/travtrack/__tests__/availability.test.ts`, `backend/src/routes/__tests__/travtrack.gate.test.ts`

**Schema** (all `@@map("travtrack_*")`, every table `user_id` FK → `users` ON DELETE CASCADE):
- `travtrack_config` — `id "default"`, `enabled Boolean @default(false)`, `updated_at`.
- `travtrack_points` — the archive's `location_points` without relay columns: `id uuid`, `seq BIGSERIAL UNIQUE`, `t`, `t_s`, `lat`, `lon`, `accuracy_m`, `altitude_m`, `speed_mps`, `course`, `motion`, `origin` (`companion:<deviceId>`), `origin_ref` (the phone's fix id `atMs:lat:lon`), `device_id`, `purpose` (CHECK `everyday|flight|trip`; the capture purpose at record time, informational), `created_at`. Indexes: `UNIQUE (user_id, t_s, lon, lat)` (Dawarich's key, spec §10.1), `UNIQUE (user_id, origin, origin_ref)`, `(user_id, t, seq)` (cursor order; no plain `(user_id, t)`).
- `travtrack_point_links` — `user_id`, `point_id` FK → `travtrack_points` ON DELETE CASCADE, `entry_kind` (CHECK `flight|trip`), `entry_id` (no FK: polymorphic), `created_at`; `PRIMARY KEY (point_id, entry_kind, entry_id)`, index `(user_id, entry_kind, entry_id)`.
- `travtrack_uploads` — receipts as `location_uploads` (`upload_id`, `payload_hash`, `result jsonb`; `UNIQUE (user_id, upload_id)`, index `created_at`).
- `travtrack_deleted_ranges` — `from_at`, `to_at`, `created_at`; index `(user_id, from_at)`. No `remote_*` columns.
- `travtrack_privacy_zones` — as `location_privacy_zones`.
- `travtrack_gaps` — what the phone reports it could not record: `device_id`, `from_at`, `to_at`, `reason` (CHECK `zonesUnknown|recorderSilent|permission`), `UNIQUE (user_id, device_id, from_at, reason)`. Never a privacy-zone gap (a zone must not be visible as one).
- `travtrack_share_snapshots` — `trip_id` (FK → `trips` ON DELETE CASCADE), `version Int`, `geometry jsonb`, `point_count`, `created_at`; `UNIQUE (trip_id)`. Read by T7.

**Interfaces:**
- `travTrackOffered(): Promise<boolean>` = `getInstanceSettings().betaFeaturesEnabled` (as `travPlanOffered`).
- `travTrackConfig(): Promise<{ enabled: boolean }>` — the row, else `{ enabled: process.env.TRAVTRACK_ENABLED === "true" }`.
- `travTrackInstanceOn(): Promise<boolean>` = offered AND config.enabled. `assertTravTrackOn()` throws `new AppError(<msg>, 403, "TRAVTRACK_DISABLED")`.
- `travTrackAvailable(userId)` (S2) = `travTrackInstanceOn()` AND not `isSharedDemoUser(userId)`.
- `GET /travtrack/capabilities` (authenticate only, read-only PAT allowed, answers whatever the switches say) → `{ version: 1, offered: boolean, enabled: boolean /* instance on */, active: boolean /* provider travtrack && status ok */, hasData: boolean }`.
- `router.use("/travtrack", …)` gate after the capabilities route: every other `/travtrack/*` path answers 403 `TRAVTRACK_DISABLED` while `travTrackInstanceOn()` is false. `GET/PATCH /travtrack/config` (admin; PATCH write scope) as `/travplan/config`.
- Beta entry: `travTrack: { why: "TravTrack, the own location history, is new and only the Companion records into it; everyday recording has not passed the field test (plan C8).", returnsWhen: "The C8 field test on Android and iPhone passed and the owner accepts /track in a browser review.", reason: "beta" }`. Its first gate site is the TravTrack card in `LocationProviderSection.tsx` (`isFeatureVisible("travTrack")` beside `choices.travtrack`; the stored choice still shows its card with the warning), because `betaFeatures.test.ts` fails on a registered key nothing gates. T6 adds the second (navigation).

- [ ] **Step 1: Failing tests** — `availability.test.ts`: "off while the beta switch is off, even with the config row on"; "the env fallback applies only without a row"; "the shared demo account never gets it"; "travTrackAvailable follows instance + demo, not the provider". `travtrack.gate.test.ts`: "capabilities answer 200 with offered/enabled false while off"; "every other /travtrack path answers 403 TRAVTRACK_DISABLED while off" (iterate the router's registered paths, so a route added later is covered); "admin config needs admin, PATCH needs write scope". `provider.test.ts` (extend S2's): "travtrack can be chosen once the instance offers it" and "status unavailable again when the admin switches it off — the choice stays". `migration.travtrack.test.ts`: replay the migration; assert the CHECK constraints refuse `purpose='walk'` and `entry_kind='cruise'`, the two unique keys on points hold, deleting a point removes its links, deleting a user removes every `travtrack_*` row.
- [ ] **Step 2:** Run `cd backend && npx jest availability travtrack.gate provider migration.travtrack --forceExit` → FAIL.
- [ ] **Step 3:** Generate the migration in the clone DB, apply to the shared dev DB with `migrate deploy`; implement availability, config, router shell, OpenAPI, admin switch, beta key.
- [ ] **Step 4:** Run the tests + `npm run check:drift` + `npx jest openapi apiResponseShape --forceExit` → PASS. Web: `npx vitest --run betaFeatures LocationProviderSection` → PASS, with a new case "the TravTrack card needs the beta key as well as `choices.travtrack`".
- [ ] **Step 5:** Commit `feat(travtrack): the tables and the instance switch`.

### Task T2: The point store (services)

**Files:**
- Create (ported, relay stripped): `backend/src/services/travtrack/classify.ts` (from `locationPoints/classify.ts`), `backend/src/services/travtrack/ingest.ts` (from `locationPoints/ingest.ts`), `backend/src/services/travtrack/zones.ts` (from `locationPoints/zones.ts`), `backend/src/services/travtrack/deleteRange.ts` (the delete half of `ingest.ts`), `backend/src/services/travtrack/links.ts`
- Modify: `backend/src/services/tripCleanupService.ts` — the trip merge (~:394, where `mergedTripRedirect` is written) moves the source trip's links to the surviving trip in the same transaction; `backend/src/jobs/cronJobs.ts` — a nightly `travtrack_orphan_links` row running `cleanupOrphanLinks()`. Flights are deleted on many paths (`routes/flights/remove.ts`, `importBatchService.ts`, `xlsxImport/prune.ts`, `sharing/adapters/flat.ts`, `travplan/execution.ts`), so instead of touching each, a link to a deleted entry is harmless by construction — every read joins the entry it names and the owner — and the sweep removes it. Points always stay.
- Tests: `backend/src/services/travtrack/__tests__/{classify,ingest,zones,links}.test.ts`

**Interfaces:**
- `classify.ts` as on the tag, plus: `judgePoint(raw, index)` reads `purpose` (`everyday|flight|trip`, default `everyday`) and `entries` (`Array<{ kind: "flight" | "trip"; id: string }>`, ≤ 4, each id ≤ 64 chars; a malformed entry makes the point `invalid`). `ParsedPoint` gains `purpose` and `entries`.
- `ingestTravTrackPoints({ userId, deviceId, uploadId, points, gaps? }): Promise<{ result: IngestResult; replayed: boolean }>` — one transaction under `takeTravTrackLock(tx, userId)` (`pg_advisory_xact_lock(hashtextextended('travtrack:'||userId, 0))`); receipt check first (`RECORDING_UPLOAD_ID_REUSED` on other content, the code the Companion already reads); then per point **zone → deleted range → duplicate** (by origin ref or by `t_s|lon|lat`). `IngestResult` = the tag's plus `linked: number` (links added) and `unlinked: number` (entries named that this account does not own — counted, logged, never stored; the point itself is stored).
- Links: `addLinks(tx, userId, pairs: Array<{ pointId; kind; id }>)` with `createMany({ skipDuplicates: true })`. A **duplicate** point still gets its missing links (the trip recorder and the flight recorder hand over the same fix in two uploads); a link is never removed by an upload. A trip id that was merged away is followed through `mergedTripRedirect` before linking.
- `gaps` (optional, ≤ 100 per upload): `{ from, to, reason }` stored with `createMany({ skipDuplicates: true })` on the same transaction; one outside `[2000, now + 1 day]` or with `to <= from` makes the upload 400.
- `deleteTravTrackRange(userId, from, to, outer?): Promise<{ deleted: number }>` — under the lock: delete points (links cascade) in `[from, to)`, delete `travtrack_gaps` inside, write a `travtrack_deleted_ranges` row, and call `onRangeDeleted(tx, userId, from, to)` — an empty hook list in T2 that T7 fills (share snapshots). Flights and trips stay untouched.
- `zones.ts` as on the tag (`LOCATION_ZONE_MAX = 20`, the exact spherical bounding box + haversine SQL, `LOCATION_ZONE_HOLDS_POINTS` with `pointsInside`, `LOCATION_ZONE_LIMIT` — codes kept, the Companion reads them), against `travtrack_points`, without `recordPointObligations`. A zone that deletes points also deletes their links (cascade).
- `links.ts` also exports `linkedPointIds(userId, kind, entryId)` for T5.

- [ ] **Step 1: Failing tests** — port from the tag's `routes/__tests__/locationPoints.test.ts` to service level: "stores every point and names each outcome"; "gives a bad point its own outcome instead of failing the batch"; "answers a retry from the receipt and refuses the id with other points"; "keys a position like Dawarich: same second and coordinates is one point, from any device"; "keeps a deleted span deleted: a late upload cannot bring it back"; "checks a far-apart batch against its own seconds only". DROP the whole `describe("what a delete still owes Dawarich, in the status code")` block. New: "one fix uploaded for the trip and again for the flight is one point with two links"; "a duplicate never removes a link"; "an entry of another account is counted unlinked and the point is still stored"; "a trip merged away links to the surviving trip"; "a point inside a zone is dropped before it is checked against a deleted range"; "a link to a deleted flight is never read and the sweep removes it, the point stays"; "merging trips moves the links and drops the ones that would collide"; "gaps are stored once and deleted with their range". From `locationZones.test.ts`: "measures distance and the zone edge the same way as the SQL"; "asks before a new zone deletes stored points, and deletes them once confirmed"; "finds stored points inside a zone that straddles the antimeridian"; "never lets the bounding box cut off a point the distance keeps"; "asks again when a zone grows over stored points"; "refuses a bad circle and more zones than the limit".
- [ ] **Step 2:** Run `npx jest services/travtrack --forceExit` → FAIL.
- [ ] **Step 3:** Port and implement. **Step 4:** Run → PASS, plus `npx jest tripMergePacking tripCleanup cronJobs --forceExit` stay green.
- [ ] **Step 5:** Commit `feat(travtrack): store positions once, linked to every flight and trip they belong to`.

### Task T3: The TravTrack API — points, summary, delete, zones

**Files:**
- Create: `backend/src/routes/travtrack/points.ts`, `backend/src/routes/travtrack/zones.ts` (mounted from `routes/travtrack.ts`, behind the T1 gate), `backend/src/schemas/travtrack.ts` (ported from the tag's `schemas/locationPoints.ts`, minus `locationSourceSchema`), OpenAPI paths in `paths/travtrack.ts`
- Tests: `backend/src/routes/__tests__/travtrack.points.test.ts`, `backend/src/routes/__tests__/travtrack.zones.test.ts`

**Interfaces** (bare, ADR 0001):
- `POST /travtrack/points` — write scope, `rejectDemo`, `flightDeviceDataLimiter`, body ≤ `LOCATION_MAX_BODY_BYTES` (413 `TRACK_BODY_TOO_LARGE`), only a paired device token (403 `TRAVTRACK_DEVICE_REQUIRED`). Body `{ uploadId, points: [{ id, t, lat, lon, accuracy?, altitude?, speed?, course?, motion?, purpose?, entries? }] (≤ 5000), gaps? }`. 201 with `IngestResult & { replayed: false }`, 200 on a replay. **Does not consult the provider** — points queued before a switch away from `travtrack` are accepted while the instance offers TravTrack (rule 2; the S4 rule, extended). No `TRIP_RECORDING_DISABLED` check (that switch governs the entry route).
- `GET /travtrack/points?from&to&cursor&limit` — oldest first by `(t, seq)`, cursor `<tMs>:<seq>`, `nextCursor` while more remain; each point carries `purpose` and `entries`.
- `GET /travtrack/summary` → `{ pointCount, firstAt, lastAt, lastReceivedAt, devices: [{ deviceId, pointCount }], deletedRanges, zones }` (the tag's, minus `source`).
- `DELETE /travtrack/points?from&to | ?fromDay&toDay` (profile clock, both days inclusive, as on the tag) → `{ deleted }`; always 200 (nothing is owed elsewhere).
- `GET/POST/PATCH/DELETE /travtrack/zones[/:id]` as the tag's `/location/zones` (PATCH, 409 `LOCATION_ZONE_HOLDS_POINTS` → resend with `deleteStoredPoints: true`). A paired device may read and write zones; a read-only PAT may only read.

- [ ] **Step 1: Failing tests** — from the tag: "takes positions only from a paired device with write access"; "refuses an empty or oversized envelope"; "reads a span in pages that never end silently, and only the owner's"; "deletes whole days on the profile's clock, both ends inclusive"; "goes with the account"; zones: "lets the paired phone read and write zones, but not a read-only token"; "keeps zones to their owner". New: "points queued before a switch to provider none are still accepted (201)"; "403 TRAVTRACK_DISABLED once the admin switches TravTrack off — and nothing is stored"; "the page carries purpose and entries"; "the summary never names a privacy zone's points or a gap inside a zone".
- [ ] **Step 2–4:** Run `npx jest travtrack.points travtrack.zones openapi apiResponseShape --forceExit` → FAIL, implement, → PASS.
- [ ] **Step 5:** Commit `feat(travtrack): take positions from the Companion, read, delete and zone them`.

### Task T4: The `LocationProvider` read interface

**Files:**
- Create: `backend/src/services/locationProvider/types.ts`, `backend/src/services/locationProvider/travtrackProvider.ts` (from the tag's `locationSource/internalReader.ts`), `backend/src/services/locationProvider/dawarichProvider.ts` (wraps `createDawarichClient`), `backend/src/services/locationProvider/resolveProvider.ts`
- Port: `backend/src/services/tripRecording/historyPoints.ts` (from the tag) onto `providerFor`
- Modify: `backend/src/services/tour/tracks/pullDawarichTrack.ts` (and the cruise pull) to take `dawarichProvider` explicitly
- Tests: `backend/src/services/locationProvider/__tests__/{travtrackProvider,dawarichProvider,resolveProvider}.test.ts`, `backend/src/services/tripRecording/__tests__/historyPoints.test.ts` (from the tag's `historyPoints.dawarich.test.ts`)

**Interfaces** (`types.ts`; no Dawarich alias anywhere):
```ts
type LocationObservation = {
  ref: string;              // provider's own id: TravTrack seq, Dawarich point id — as a string
  atMs: number; lat: number; lon: number;
  accuracyM: number | null; altitudeM: number | null; speedMps: number | null; courseDeg: number | null;
  deviceId: string | null;
};
type ReadWindow = { fromMs: number; untilMs: number };           // [from, until)
type Coverage = "complete" | "truncated" | "unreachable";
type ReadResult = { points: LocationObservation[]; next: string | null; coverage: Coverage };
interface LocationProvider {
  kind: "travtrack" | "dawarich";
  readPoints(window: ReadWindow, cursor?: string): Promise<ReadResult>;
  getCoverage(window: ReadWindow): Promise<{ coverage: Coverage; pointCount: number | null; gaps: Array<{ fromMs: number; untilMs: number; reason: "deleted" | "reported" }> }>;
}
```
- `travtrackProvider(userId, cap = 50_000)` — ascending by `(t, seq)`, `next` cursor while more remain (`coverage: "complete"` per page; `"truncated"` only when a caller stops early). `getCoverage` names deleted ranges and reported gaps inside the window.
- `dawarichProvider(connection)` — converts `[from, until)` to Dawarich's inclusive window (`endAt = until - 1`), never paginates past `MAX_PAGES * PAGE_SIZE`: `next: null`, `coverage: "truncated"` when the client said so; any client error → `{ points: [], next: null, coverage: "unreachable" }` (logged), never a throw into an entry page. `getCoverage` = one read, `gaps: []`.
- `providerFor(userId): Promise<LocationProvider | null>` — by `getLocationProvider`: `travtrack` + `ok` → TravTrack; `dawarich` + `ok` → Dawarich with the **user-tier** connection only; anything else → null.
- Explicit pulls ("aus Dawarich holen" for a tour or cruise) call `dawarichProvider(getDawarichConnection(userId))` directly, whatever the provider (unchanged behaviour).
- **Not moved in phase 2:** the stay scan (`dawarich/stays/window.ts`, which keys suggestions on Dawarich's numeric point ids), market visits inside it, and the country-day sweep keep their direct `DawarichClient` reads and S3's `dawarich`-only selection. They move onto `providerFor` in phase 3, together with the TravTrack suggestions that give them a second source; moving them now changes nothing a user sees and risks Review Focus 1.

- [ ] **Step 1: Failing tests** — from the tag's `locationSource.test.ts` "the internal reader": "answers a window ascending with string refs" (half-open now), "pages with a cursor instead of dropping the oldest". `dawarichProvider`: "an inclusive Dawarich window is read for a half-open request"; "a truncated read says truncated and offers no cursor"; "an unreachable Dawarich answers unreachable, it does not throw". `resolveProvider`: "none → null"; "dawarich with only the admin-global connection → null" (privacy boundary); "travtrack while the instance is off → null". `historyPoints` (from the tag, rewritten): "a trip reads its share of TravTrack points per device, minus the flight window"; "a Dawarich provider's points come back with coverage, truncated said as truncated"; "a point held both in a #316 batch and in TravTrack is shown once". Tour pull: "pull from Dawarich works for a provider-travtrack user with an own connection".
- [ ] **Step 2–4:** Run `npx jest locationProvider historyPoints pullDawarichTrack --forceExit` → FAIL, implement, → PASS; existing `dawarich*` suites unchanged and green.
- [ ] **Step 5:** Commit `feat(location): one read interface for TravTrack and Dawarich`.

### Task T5: Entry tracks from the provider — and the capability flip

**Files:**
- Create: `backend/src/services/locationProvider/entryTrack.ts`
- Modify: `backend/src/routes/flights/track.ts` (`GET /flights/:id/track`), `backend/src/routes/trips/tripRecording.ts` (`loadDevices`, `GET /trips/:id/recording` and `/gpx`), `backend/src/services/locationProvider/capabilities.ts` (the flip), OpenAPI paths for both GETs, `frontend` flight + trip track views (origin label, coverage note, source toggle), `i18n/resources/{de,en}/{flights,trips}.json`
- Tests: `backend/src/services/locationProvider/__tests__/entryTrack.test.ts`, `backend/src/routes/__tests__/flightTrack.provider.test.ts`, `backend/src/routes/__tests__/tripRecording.provider.test.ts`, `routes/__tests__/locationCapabilities.test.ts` (flip), web tests for the label and toggle

**Interfaces:**
- `entryTrack(userId, entry: { kind: "flight" | "trip"; id: string }, opts?: { source?: "travstats" | "travtrack" | "dawarich" }): Promise<{ origin: "travstats" | "travtrack" | "dawarich" | null; coverage: Coverage | null; alternatives: Array<"travstats" | "travtrack" | "dawarich">; points: StoredPoint[] }>`
  - Default: an own `FlightTrack` / `TripRecordingBatch` exists → `origin: "travstats"`, whatever the provider (existing recordings keep showing after any switch). Otherwise `providerFor(userId)`.
  - TravTrack for an entry = points **linked** to it ∪ points inside its window (flight: `recorderWindow`; trip: `tripRecordingBounds`, flight windows classified `inFlight` as today, so they stay a break), deduped by point id. Links keep a fix recorded for a delayed flight; the window catches everyday fixes.
  - Dawarich for an entry = the window, through `dawarichProvider`.
  - `alternatives` lists other sources that hold something for the window; `?source=` picks one explicitly (an extra view, never a silent swap). An unknown or empty source → 404 `TRACK_SOURCE_NOT_AVAILABLE`.
- Segments: the existing gap cut, plus a cut wherever the chord between two consecutive points passes within a current privacy zone (`segmentCrossesZone(a, b, zone)`, distance from the centre to the segment ≤ radius) — no line through a zone.
- `GET /flights/:id/track` → `{ track, origin, coverage, alternatives }` (additive; `track` keeps its shape). `GET /trips/:id/recording` → `summary.origin`, `summary.coverage`, `summary.alternatives` added; `?source=` on both and on the GPX.
- **The flip** (`capabilities.ts`, Codex's sequencing rule): `capture.flight = (kind === "none" || kind === "travtrack") && flightLiveTrackingEnabled`, same for `trip`; new field `capture.sink: "entries" | "travtrack" | null` — `travtrack` when `kind === "travtrack" && status === "ok"`, `entries` for `none`, `null` when nothing is recorded. Same commit as the Dawarich reads, so a `dawarich` user stops recording exactly when Dawarich tracks appear on the flight and trip pages. Update the module comment and ADR pointer.

- [ ] **Step 1: Failing tests** — `entryTrack`: "an own recording stays the default after a switch to dawarich, labelled travstats"; "no own recording and provider dawarich → the window from Dawarich, coverage carried"; "no own recording and provider travtrack → linked and window points, once each"; "a fix linked to a delayed flight outside its scheduled window still shows"; "the trip track keeps the flight window as a break"; "two fixes on either side of a privacy zone, two minutes apart, are two segments"; "?source=dawarich on an entry with an own recording shows Dawarich and says so"; "a Dawarich timeout answers coverage unreachable with the own recording untouched". Capabilities: "provider dawarich: capture.flight and capture.trip false, sink null"; "provider travtrack: both true with sink travtrack"; "provider none: sink entries". Web: the "TravStats-Aufzeichnung" / "aus TravTrack" / "aus Dawarich" label, the truncated/unreachable note, the toggle only when `alternatives` is non-empty.
- [ ] **Step 2–4:** Run `npx jest entryTrack flightTrack.provider tripRecording locationCapabilities openapi --forceExit` and `npx vitest --run FlightTrack TripRecording` → FAIL, implement, → PASS.
- [ ] **Step 5:** Commit `feat(location): flight and trip tracks from the chosen source; Dawarich users stop recording`.

### Task T6: Web — `/track` and the TravTrack settings

**Files:**
- Create (server): `backend/src/routes/travtrack/day.ts` (`GET /travtrack/day`), `backend/src/routes/travtrack/export.ts` (`GET /travtrack/export`), `backend/src/services/travtrack/dayView.ts`, `backend/src/services/travtrack/exportFormats.ts` (GPX via `services/tripRecording/gpx.ts`, JSON)
- Create (web): `frontend/src/pages/Track/TrackPage.tsx` (+ `TrackDayMap.tsx`, `TrackTimeline.tsx`, `TrackCoverageBar.tsx`, `TrackExportDialog.tsx`, `TrackDeleteDialog.tsx`), `frontend/src/hooks/useTravTrackVisible.ts`, `frontend/src/components/Settings/TravTrackSection.tsx` (ported from the tag's `LocationHistorySection.tsx`: summary, zones, delete by days — without the source switch and without `TransferNotes`), `frontend/src/lib/api/travtrack.ts` (extend T1's; port of `lib/api/locationHistory.ts` minus source/transfer), `i18n/resources/{de,en}/track.json`
- Modify: `frontend/src/App.tsx` (routes `/track`, `/track/:date`), `frontend/src/components/Nav/useNavItems.ts` (collections group, entry "Track"), `pages/Settings/settingsModel.ts` (TravTrack section under "location", after `LocationProviderSection`)
- Tests: `backend/src/routes/__tests__/travtrack.day.test.ts`, `travtrack.export.test.ts`; Vitest `TrackPage.test.tsx`, `TrackCoverageBar.test.tsx`, `TravTrackSection.test.tsx` (ported), `useTravTrackVisible.test.ts`

**Interfaces:**
- `GET /travtrack/day?date=YYYY-MM-DD` (profile clock) → `{ date, zone, segments: StoredPoint[][], coverage: Array<{ fromMs; untilMs; state: "recorded" | "noData" | "deleted" | "phonePaused" }>, context: Array<{ kind: "flight" | "trip" | "home"; id: string | null; label: string; fromMs: number; untilMs: number }>, pointCount }`. Context from TravStats: the day's flights (scheduled/actual window), trips spanning the day, and stretches within 300 m of `user_settings.home_place`. "phonePaused" comes from `travtrack_gaps`; a privacy zone never appears as a state.
- `GET /travtrack/export?from&to&format=gpx|json` — GPX one `<trkseg>` per segment; JSON `{ version: 1, origin: "travtrack", coverage, points: [...], gaps, deletedRanges }`. Bounded to 366 days per request (400 otherwise).
- `useTravTrackVisible()` = `isFeatureVisible("travTrack")` AND `/travtrack/capabilities` `enabled` AND (`active` OR `hasData`); fails closed while pending.
- Page (prototype board "Track-Tag"): day picker, map (MapLibre, line by segment, no dots at world zoom), timeline with context labels, coverage bar, zones overlay (own zones only), "Exportieren" (GPX/JSON), "Zeitraum löschen" (confirm names the count from `/travtrack/summary`-style preview, then `DELETE /travtrack/points?fromDay&toDay`). Every failure maps a code to DE/EN copy (`TRAVTRACK_DISABLED`, `LOCATION_ZONE_HOLDS_POINTS`, network).

- [ ] **Step 1: Failing tests** — server: "a day on the profile clock, with flights, trip and home as context"; "a reported gap is phonePaused, a deleted range is deleted, nothing marks a zone"; "export GPX and JSON carry origin and coverage, only the owner's"; "a span over 366 days is refused". Web: "the menu entry appears only with the beta key, the instance on and provider travtrack or data"; "the day shows segments and labels them from TravStats context"; "delete asks with the count and refreshes the day"; "TRAVTRACK_DISABLED shows its copy, not an empty map"; ported `TravTrackSection` cases ("says what is stored, and that nothing is"; "asks before a new zone deletes stored positions, then adds it"; "names coordinates it cannot read and adds nothing"; "removes a zone after confirmation"; "deletes the chosen days after confirmation and says how many") — the source and transfer cases are dropped.
- [ ] **Step 2–4:** FAIL → implement → PASS; `localeKeyParity` green; `npm run check:size`.
- [ ] **Step 5:** Browser look (dev stack + seeded TravTrack points): map, coverage bar, delete. Commit `feat(travtrack): the day view on the web`.

### Task T7: Export, backup and the shared-trip snapshot

**Files:**
- Modify: `backend/src/services/export/allDataExport.ts` (a `travtrack` section built by `buildTravTrackExport(userId)`, paged in 5000s: points with links, zones, deleted ranges, gaps; not in `USER_EXPORT_SELECT` so a million points are not one Prisma read), `backend/src/services/travtrack/deleteRange.ts` (`onRangeDeleted` gets the snapshot hook)
- Create: `backend/src/services/travtrack/shareSnapshot.ts`, `backend/src/routes/travtrack/shareSnapshot.ts`; web toggle in the trip share dialog ("Route mitteilen" / "Share the route")
- Tests: `backend/src/services/travtrack/__tests__/shareSnapshot.test.ts`, extend `routes/admin/__tests__/exportAllData.test.ts`, `services/backup/__tests__/backupService.test.ts` (or a new `travtrack.backup.test.ts`), `routes/__tests__/tripRecording.private.test.ts` (stays green)

**Interfaces:**
- Backup is the whole-database `pg_dump`, so the tables are in it already; the test pins that no `--exclude-table` names a `travtrack_*` table and that a restore keeps `seq` (sequence restored).
- `buildShareSnapshot(userId, tripId): Promise<{ version: number; geometry: [lon, lat][][]; pointCount }>` — the trip's TravTrack entry track (T5) filtered: inside the trip window only, privacy zones cut, everything within 1 km of `home_place` dropped, no timestamps (geometry only), simplified to ≤ 2000 vertices. Stored in `travtrack_share_snapshots` with `version` raised on each rebuild.
- `PUT /trips/:id/share-snapshot` (owner, write scope) builds or rebuilds; `DELETE` revokes; a recipient's linked copy reads it through the trip's share membership (`services/sharing/members.ts`) at `GET /trips/:id/shared-route` → `{ version, geometry }` or 404. A range delete overlapping the trip window removes the snapshot (via `onRangeDeleted`); a trip delete cascades.
- Own recordings stay private exactly as `tripRecording.private.test.ts` pins: no snapshot unless the owner asks for one; never in a `.travstats` file, public link, comparison or federation.

- [ ] **Step 1: Failing tests** — "the account export carries TravTrack points with their links, zones, deleted ranges and gaps"; "a backup excludes no travtrack table"; "a snapshot holds geometry only, nothing near home, nothing inside a zone, nothing outside the trip"; "a rebuild raises the version"; "revoking removes it for every recipient"; "deleting a range over the trip removes the snapshot"; "a recipient reads the snapshot, never the points"; "no snapshot exists until the owner shares the route".
- [ ] **Step 2–4:** FAIL → implement → PASS (`npx jest shareSnapshot exportAllData backup tripRecording.private --forceExit`, `npx vitest --run TripShare`).
- [ ] **Step 5:** Commit `feat(travtrack): in the export and backup; a shared trip carries only a route snapshot`.

### Task T8: TravTrack as the default for new accounts

**Files:**
- Create: `backend/src/services/locationProvider/initialProvider.ts`
- Modify: the three creation sites — `routes/auth.ts` (register, ~:143), `routes/setup.ts` (first admin, ~:121), `routes/admin/users.ts` (~:52) — inside their transactions
- Test: `backend/src/services/locationProvider/__tests__/initialProvider.test.ts`

**Interfaces:**
- `initialLocationProvider(tx, userId): Promise<LocationProviderKind>` — `travTrackInstanceOn()` → create the settings row with `locationProvider: "travtrack"`, `rev 0`; otherwise write nothing (no row reads as `none`). Never for the demo seeds (`seedDemoAccount.ts`, `seedDemoUser.ts`).

- [ ] **Step 1: Failing tests** — "an account registered while TravTrack is on starts on travtrack"; "the first admin of a fresh instance starts on none (TravTrack is off on a fresh install)"; "switching TravTrack on later changes no existing account" (rows and `rev` untouched); "an admin-created account follows the same rule"; "the demo account stays none".
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat(location): new accounts start on TravTrack where it is on`.

### Task C6: Companion — TravTrack as the sink

Repo `/home/claude/projekte/TravStatsCompanion`, branch `feat/travtrack-p2` off `feat/travtrack-p1`. Consumes T1–T3 and T5's `capture.sink`.

**Files:**
- Modify: `app/src/lib/location/capabilities.ts` (sanitize `capture.sink`; `travTrackSink(caps): boolean`), `app/src/lib/server/api/location.ts` (`uploadTravTrackPoints` → `POST /travtrack/points`; zones → `/travtrack/zones`), `app/src/lib/location/route.ts` (the route is known from the capabilities — `present` iff `caps.travTrack.enabled`; the OpenAPI probe for `/location/points` goes, that path never shipped), `app/src/lib/location/queue.ts`, `app/src/lib/location/collect.ts`, `app/src/lib/location/upload.ts`, `app/src/lib/location/privacy-zones.ts`, `app/src/lib/location/hold.ts`, `app/src/lib/flight-track/background.ts` + `trip-track/background.ts` (`sink` on the armed state), `app/src/lib/flight-track/upload.ts` + `background-upload.ts` (skip `sink: 'travtrack'` tracks)
- Tests: the existing `__tests__` of each, plus `lib/location/__tests__/sink.test.ts`

**Interfaces:**
- `QueuedPoint` gains `purpose: 'everyday' | 'flight' | 'trip'` and `entries: Array<{ kind: 'flight' | 'trip'; id: string }>`; `enqueueLocations` merges the entries of a fix already in the open batch (same `fixId`) instead of dropping the second hand-over.
- `EnvelopeTarget` gains `{ kind: 'travtrack' }`; `QueueRoute` gains `'travtrack'`. Envelopes already frozen keep their target (`trip` envelopes queued under `none` still go to `/trips/:id/recording`). Unsent `{ kind: 'points' }` batches of phase 1 are taken by the `travtrack` route once it is present.
- `FlightArmed.sink` / `TripArmed.sink`: `'entries' | 'travtrack'`, frozen when the purpose is armed from `capture.sink`. A `travtrack` flight still records its local track for the phone's screen but the flight-track uploader skips it; a `travtrack` trip files fixes with `entries` and target `travtrack`, never `tripId` for `/trips/:id/recording`. So no entry gets both an own track and history points.
- Upload answers: `TRAVTRACK_DISABLED` (403) → state `{ kind: 'travTrackOff' }`, batch kept, `RETRY_LATER_MS`; `TRAVTRACK_DEVICE_REQUIRED` → `refused`; the T2 outcome counts (`unlinked`) are counted in `stats.ts`.
- Zones: `refreshPrivacyZones` against `/travtrack/zones` on foreground, on opening the location screen, and before a TravTrack purpose starts; `STORE_KEYS.privacyZonesFetchedAt`. **Stale or unknown zones are handled conservatively:** a list once fetched keeps filtering however old (a zone never lapses offline; the server drops what a newer zone covers). With no list ever fetched for this account, TravTrack fixes are held (`hold.ts`) and released through the zone filter once a list arrives; nothing leaves the phone before. Each such hold, a watchdog revive after silence (`recorderSilent`) and a missing „Immer" permission (`permission`) is kept as a gap `{ fromMs, toMs, reason }` and sent with the next upload's `gaps`.

- [ ] **Step 1: Failing tests** — "under sink travtrack a trip's fix is queued with purpose trip and the trip in entries, target travtrack"; "the same fix from the flight and the trip recorder is one queued point with both entries"; "a trip envelope queued under none still goes to /trips/:id/recording after the switch"; "a travtrack flight's track is recorded but never uploaded to /flights/:id/track"; "403 TRAVTRACK_DISABLED keeps the batch and says so"; "no zone list yet: fixes are held and nothing is sent; the list arrives and the held fixes inside a zone never leave the phone"; "an old zone list keeps filtering offline"; "a held stretch and a revive are sent as gaps"; "another account's zones and queue are never read" (account-session tests stay green); "legacy and phase-1 servers: everything as before" (existing cases).
- [ ] **Step 2–4:** `cd app && npx jest lib/location lib/flight-track lib/trip-track` → FAIL, implement, → PASS; `npx tsc --noEmit`; `npm run test:time-zones`.
- [ ] **Step 5:** Commit `feat(location): record flights and trips into TravTrack`.

### Task C7: Companion — modes Aus / Flug & Reise / Alltag

**Files:**
- Modify: `app/src/lib/location-privacy.ts` (`LocationMode` gains `'everyday'`; `LOCATION_MODES` offers it only when `caps.capture.modes` includes `everyday`), `app/src/components/location/useLocationMode.ts` (`STORE_KEYS.everydayCapture`, asks for „Immer" like the trip mode), `app/src/lib/location/capture-plan.ts` + `coordinator.ts` (third purpose), `app/src/app/settings/location.tsx`, `app/src/components/location/{LocationModeRow.tsx,copy.ts}` (DE + EN), `app/src/components/location/PrivacyZones.tsx` (shown when `caps.travTrack.enabled`)
- Create: `adrs/0016-travtrack-everyday-capture.md` (+ index in `adrs/README.md`); amend `0015` "Consequences" to point at it
- Tests: `lib/location/__tests__/capture-plan.test.ts`, `coordinator.test.ts`, the settings screen test

**Interfaces:**
- `CapturePlanInput.everyday: { enabled: boolean } | null`; `CaptureRate` gains `'everyday'` (Balanced, 500 m, 5 min, iOS `pausesUpdatesAutomatically`, Android notification "TravTrack zeichnet auf" / "TravTrack is recording"). Precedence: flight > tripFine > tripCoarse > everyday — a flight or trip raises precision in place (`update`), its end drops back to everyday without a stop (ADR 0015 point 4).
- `captureDecision(caps, 'everyday')` gates it; `deny` stops only the everyday purpose. A fix delivered while flight/trip are armed carries their purposes and entries; otherwise `purpose: 'everyday'`, `entries: []`.
- Screen (prototype board "Companion"): with `caps.capture.modes` non-empty, three choices — **Aus** (`manual`), **Flug & Reise** (`activeTrip`), **Alltag** (`everyday`); otherwise today's screen (C4). Under `dawarich` the C4 text stays.

- [ ] **Step 1: Failing tests** — "Alltag alone runs one task at the everyday rate"; "a trip starting during Alltag raises the rate in place, no stop"; "landing inside a trip during Alltag goes flight → trip → everyday without a restart"; "capture.everyday false stops only the everyday purpose"; "the watchdog revives a silent everyday task"; "Alltag is not offered while the server lists no everyday mode"; "choosing Alltag asks for Immer and stays off on a refusal"; "privacy zones shown only with TravTrack enabled".
- [ ] **Step 2–4:** FAIL → implement → PASS; `npx tsc --noEmit`, `npm run test:time-zones`.
- [ ] **Step 5:** Commit `feat(location): everyday recording for TravTrack`.

### Task C8: Field test on real phones

**Files:** `adrs/0016-travtrack-everyday-capture.md` (results), board item.

Before everyday recording is advertised or `travTrack` leaves the beta registry. Build a beta APK + TestFlight from `feat/travtrack-p2` against the Beta server (CT 106) with TravTrack switched on.

- [ ] **Step 1:** Android (the Xiaomi from P0) and iPhone, one ordinary day on **Alltag** with a short trip and a flight-mode simulation: one notification at a time; the rate rises and falls in place.
- [ ] **Step 2:** The P0 failure modes on purpose: swipe away, `adb shell am crash`, reboot, permission downgrade to „Beim Verwenden". Expected: each silence ends at the next app start or background task (watchdog), and each one appears on `/track` as „Telefon pausiert" — never as recorded, never unexplained.
- [ ] **Step 3:** Measure battery per hour unplugged, fixes per hour, share ≤ 20 m, upload delay; a privacy zone at home: no fix inside it on the server, no gap shown for it.
- [ ] **Step 4:** Record numbers and verdict in ADR 0016. Owner decides whether `travTrack`'s `returnsWhen` is met.

### Phase 2 exit

- [ ] Server gates (Build Checks) green on `dev/travtrack`; `npm run check:drift` green with the one TravTrack migration; Companion `tsc` + `npm test` + `test:time-zones` green.
- [ ] Codex review of both diffs since phase 1; findings fixed.
- [ ] Browser look at `/track` and the flight/trip origin labels; C8 recorded.
- [ ] Ask the owner, as a single question, whether phase 2 goes to `main` / an RC (still behind `travTrack`).

## Phase 3 — TravTrack helps TravStats

Stay and country-day suggestions from TravTrack into the existing inbox (same cards as Dawarich stays, `EvidenceSuggested` with id, provider + rev, window, algorithm version; accept is idempotent and re-checks the evidence; an accepted entry never counts as evidence for itself); missing-journey suggestions; GPX import; OwnTracks and Overland ingest.

## Phase 4 — later

Erkundet map (fog of war), Zuletzt gesehen, monthly values, journey/trip inference, TravPlan plan-vs-actual, Dawarich history import as an explicit copy with a completeness report.
