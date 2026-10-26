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

7. **TravTrack points survive a switch** — points the phone queued for TravTrack are accepted while the instance offers TravTrack, whatever the account's provider is by then (`/location/capabilities` `travTrack.upload`, separate from `travTrack.capture`); `403 TRAVTRACK_DISABLED` keeps them on the phone. Envelopes frozen for `/trips/:id/recording` keep that target. Pinned in T3 and C6.
8. **One fix, two entries** — a fix the flight and the trip recorder both hand over is one point with two links; a duplicate upload adds a missing link and never drops one; no entry ever has both an own track and TravTrack points for the same recording (`sink` frozen at arm time). Pinned in T2 and C6.
9. **Delete is final** — a range delete removes points and links, clips gaps (and a later upload cannot re-create one inside the tombstone), narrows overlapping share snapshots (removes their vertices in it; never selects points again), leaves a tombstone a late upload cannot cross, and leaves flights and trips standing. Pinned in T2, T3, T7.
10. **Privacy zones** — a fix inside one never leaves the phone (no zone list yet → held, not sent); ingest drops it again; no line is drawn through a zone, and no coverage state, gap or export reveals one. Pinned in T2, T5, T6, C6.
11. **Dawarich users at the flip** — recording stops in the same commit that shows Dawarich tracks on flight and trip pages; their own earlier recordings still show as "TravStats-Aufzeichnung"; an unreachable Dawarich says so and never hides an own recording. Pinned in T5.
12. **A phase-1 Companion against a phase-2 server** — it ignores `capture.sink`, so under provider `travtrack` it records flights and trips through the entry routes as before (true flags, own uploaders). Accepted: the server is still the record and nothing is doubled. Pinned in T5 (capabilities stay version 1, additive).
13. **Stays and country days do not move yet** — they keep their direct Dawarich reads and S3's selection in phase 2 (T4); a TravTrack user gets no derived suggestion until phase 3.
14. **Decided (owner's concept, prototype rule "TravTrack aus heißt: keine neue Erfassung, nichts wird gelöscht, Export und Löschen bleiben möglich"):** with TravTrack switched off while an account holds TravTrack data, `GET /travtrack/summary`, the TravTrack export and `DELETE /travtrack/points` (and zone delete) stay open for accounts that hold data; ingest, day views and derivations answer 403 `TRAVTRACK_DISABLED`. T3 tests this.
15. **Shared routes and privacy** — a shared route snapshot is privacy-checked on its final, simplified geometry. Only the owner's share selects points; afterwards it is only ever narrowed (range deletes, zones, homes, trip days — by vertex time and circle, `updateMany` on id + version, never an upsert, so a revoke wins), and every recipient read narrows the stored geometry again by the rules in force — plus every home, flight and narrower span of days recorded since by trigger, in the change's own transaction — without reading a raw point. Pinned in T2, T5 (`privacyCut`), T7.
16. **A flight's sink outlives its armed state** — provenance per stored track; no provenance means the old entry upload. Pinned in C6.

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
- `holdsTravTrackData(userId): Promise<boolean>` — any `travtrack_points`, `travtrack_privacy_zones`, `travtrack_gaps` or `travtrack_deleted_ranges` row (one `EXISTS` per table, `UNION ALL … LIMIT 1`).
- `travTrackAvailable(userId)` (S2) = `travTrackInstanceOn()` AND not `isSharedDemoUser(userId)`.
- `GET /travtrack/capabilities` (authenticate only, read-only PAT allowed, answers whatever the switches say) → `{ version: 1, offered: boolean, enabled: boolean /* instance on: capture and views */, active: boolean /* provider travtrack && status ok */, hasData: boolean /* holdsTravTrackData: summary, export and delete reachable */ }`.
- **Capture vs upload in `/location/capabilities`** (S4, extended here): `travTrack` becomes `{ offered, enabled /* = active, kept for the phase-1 Companion */, capture: boolean /* provider travtrack && ok: start recording into TravTrack */, upload: boolean /* travTrackInstanceOn(): the server takes /travtrack/points */ }`. `upload` does not depend on the provider, so points queued for TravTrack still leave the phone after a switch to `none` or `dawarich`.
- **Three gate tiers, not one blanket gate** (Review Focus 14; Codex phase-2 review). Each route names its tier in `routes/travtrack.ts`; a route with no tier fails the gate test.
  - `open` — `GET /travtrack/capabilities`: answers whatever the switches say.
  - `offered` — `GET/PATCH /travtrack/config` (admin; PATCH write scope): only `assertTravTrackOffered()` (beta switch), exactly as `/travplan/config` sits behind `assertTravPlanOffered` and not behind `assertEnabled` — otherwise the switch that turns TravTrack on could never be reached.
  - `on` — everything that captures or derives: `POST /travtrack/points`, `GET /travtrack/points`, `GET /travtrack/day`, zone create/update, `PUT /trips/:id/share-snapshot`, and every provider read through `providerFor` (T4). 403 `TRAVTRACK_DISABLED` unless `travTrackInstanceOn()`.
  - `held` — `GET /travtrack/summary`, `GET /travtrack/export`, `DELETE /travtrack/points`, `GET /travtrack/zones`, `DELETE /travtrack/zones/:id`: allowed while the instance is on, OR while `holdsTravTrackData(userId)`; otherwise 403 `TRAVTRACK_DISABLED`. "TravTrack aus heißt: keine neue Erfassung, nichts wird gelöscht, Export und Löschen bleiben möglich."
  - Middleware: `travTrackTier("on" | "held" | "offered")` in `routes/travtrack/gate.ts`.
- Beta entry: `travTrack: { why: "TravTrack, the own location history, is new and only the Companion records into it; everyday recording has not passed the field test (plan C8).", returnsWhen: "The C8 field test on Android and iPhone passed and the owner accepts /track in a browser review.", reason: "beta" }`. Its first gate site is the TravTrack card in `LocationProviderSection.tsx` (`isFeatureVisible("travTrack")` beside `choices.travtrack`; the stored choice still shows its card with the warning), because `betaFeatures.test.ts` fails on a registered key nothing gates. T6 adds the second (navigation).

- [ ] **Step 1: Failing tests** — `availability.test.ts`: "off while the beta switch is off, even with the config row on"; "the env fallback applies only without a row"; "the shared demo account never gets it"; "travTrackAvailable follows instance + demo, not the provider". `travtrack.gate.test.ts`: "capabilities answer 200 with offered/enabled false while off"; "every registered /travtrack route names a tier" (iterates the router stack, so a route added later is covered); "with TravTrack off, every on-tier route answers 403 TRAVTRACK_DISABLED"; "with TravTrack off, an account holding data reaches summary, export, point delete, zone list and zone delete"; "with TravTrack off, an account holding nothing gets 403 on the held tier too"; "the admin can PATCH the config while the beta switch is on and TravTrack is still off" (the switch is reachable); "config answers 403 while the beta switch is off"; "admin config needs admin, PATCH needs write scope". `locationCapabilities.test.ts` (extend): "travTrack.upload stays true after a switch to provider none while the instance takes points"; "travTrack.capture is false then"; "upload false once the admin switches TravTrack off". `provider.test.ts` (extend S2's): "travtrack can be chosen once the instance offers it" and "status unavailable again when the admin switches it off — the choice stays". `migration.travtrack.test.ts`: replay the migration; assert the CHECK constraints refuse `purpose='walk'` and `entry_kind='cruise'`, the two unique keys on points hold, deleting a point removes its links, deleting a user removes every `travtrack_*` row.
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
- `gaps` (optional, ≤ 100 per upload) — **one wire contract on both sides:** `{ from: string, to: string, reason: "zonesUnknown" | "recorderSilent" | "permission" }`, `from`/`to` ISO instants with offset like every point's `t` (the Companion converts its internal `fromMs/toMs` at upload). An envelope may carry gaps and no points (`points` min 0, refined: at least one point or one gap). One outside `[2000, now + 1 day]` or with `to <= from` makes the upload 400. Before storing, each gap is **clipped against the account's deleted ranges** (a part inside a tombstone is dropped, a gap may split in two), so a late upload cannot re-create a gap in a deleted span. Stored with `createMany({ skipDuplicates: true })` in the same transaction.
- `deleteTravTrackRange(userId, from, to, outer?): Promise<{ deleted: number; gapsClipped: number }>` — under the lock: delete points (links cascade) in `[from, to)`; **clip** every `travtrack_gaps` row that overlaps (inside → deleted, overlapping an edge → shortened, spanning the range → split in two); write a `travtrack_deleted_ranges` row; then call `onPointsRemoved(tx, userId, { kind: "range", from, to })`. Flights and trips stay untouched.
- `onPointsRemoved(tx, userId, cause: { kind: "range"; from: Date; to: Date } | { kind: "zone"; zone: ZoneCircle })` — the one hook every point removal calls, in its transaction; an empty list in T2 that T7 fills (share snapshots). Zone create and update call it with `kind: "zone"` **whether or not they deleted points**: a zone over no stored point can still lie under a chord of a shared route.
- `zones.ts` as on the tag (calling `onPointsRemoved` on every create/update; `LOCATION_ZONE_MAX = 20`, the exact spherical bounding box + haversine SQL, `LOCATION_ZONE_HOLDS_POINTS` with `pointsInside`, `LOCATION_ZONE_LIMIT` — codes kept, the Companion reads them), against `travtrack_points`, without `recordPointObligations`. A zone that deletes points also deletes their links (cascade).
- `links.ts` also exports `linkedPointIds(userId, kind, entryId)` for T5.

- [ ] **Step 1: Failing tests** — port from the tag's `routes/__tests__/locationPoints.test.ts` to service level: "stores every point and names each outcome"; "gives a bad point its own outcome instead of failing the batch"; "answers a retry from the receipt and refuses the id with other points"; "keys a position like Dawarich: same second and coordinates is one point, from any device"; "keeps a deleted span deleted: a late upload cannot bring it back"; "checks a far-apart batch against its own seconds only". DROP the whole `describe("what a delete still owes Dawarich, in the status code")` block. New: "one fix uploaded for the trip and again for the flight is one point with two links"; "a duplicate never removes a link"; "an entry of another account is counted unlinked and the point is still stored"; "a trip merged away links to the surviving trip"; "a point inside a zone is dropped before it is checked against a deleted range"; "a link to a deleted flight is never read and the sweep removes it, the point stays"; "merging trips moves the links and drops the ones that would collide"; "gaps are stored once"; "a gap uploaded into a deleted range is not stored, one straddling it is clipped to the outside"; "deleting a range shortens a gap that overlaps its edge and splits one that spans it"; "a gap-only upload is accepted and answered like any other"; "an upload with neither points nor gaps is 400"; "a zone create and a zone update call onPointsRemoved even when they delete nothing". From `locationZones.test.ts`: "measures distance and the zone edge the same way as the SQL"; "asks before a new zone deletes stored points, and deletes them once confirmed"; "finds stored points inside a zone that straddles the antimeridian"; "never lets the bounding box cut off a point the distance keeps"; "asks again when a zone grows over stored points"; "refuses a bad circle and more zones than the limit".
- [ ] **Step 2:** Run `npx jest services/travtrack --forceExit` → FAIL.
- [ ] **Step 3:** Port and implement. **Step 4:** Run → PASS, plus `npx jest tripMergePacking tripCleanup cronJobs --forceExit` stay green.
- [ ] **Step 5:** Commit `feat(travtrack): store positions once, linked to every flight and trip they belong to`.

### Task T3: The TravTrack API — points, summary, delete, zones

**Files:**
- Create: `backend/src/routes/travtrack/points.ts`, `backend/src/routes/travtrack/zones.ts` (mounted from `routes/travtrack.ts`, behind the T1 gate), `backend/src/schemas/travtrack.ts` (ported from the tag's `schemas/locationPoints.ts`, minus `locationSourceSchema`), OpenAPI paths in `paths/travtrack.ts`
- Tests: `backend/src/routes/__tests__/travtrack.points.test.ts`, `backend/src/routes/__tests__/travtrack.zones.test.ts`

**Interfaces** (bare, ADR 0001):
- `POST /travtrack/points` — write scope, `rejectDemo`, `flightDeviceDataLimiter`, body ≤ `LOCATION_MAX_BODY_BYTES` (413 `TRACK_BODY_TOO_LARGE`), only a paired device token (403 `TRAVTRACK_DEVICE_REQUIRED`). Body `{ uploadId, points: [{ id, t, lat, lon, accuracy?, altitude?, speed?, course?, motion?, purpose?, entries? }] (0–5000), gaps?: [{ from, to, reason }] (0–100) }` — at least one point or one gap. 201 with `IngestResult & { replayed: false }`, 200 on a replay. **Does not consult the provider** — points queued before a switch away from `travtrack` are accepted while the instance offers TravTrack (rule 2; the S4 rule, extended). No `TRIP_RECORDING_DISABLED` check (that switch governs the entry route).
- `GET /travtrack/points?from&to&cursor&limit` — oldest first by `(t, seq)`, cursor `<tMs>:<seq>`, `nextCursor` while more remain; each point carries `purpose` and `entries`.
- `GET /travtrack/summary` → `{ pointCount, firstAt, lastAt, lastReceivedAt, devices: [{ deviceId, pointCount }], deletedRanges, zones }` (the tag's, minus `source`).
- `DELETE /travtrack/points?from&to | ?fromDay&toDay` (profile clock, both days inclusive, as on the tag) → `{ deleted }`; always 200 (nothing is owed elsewhere).
- Tiers (T1): POST/GET points `on`; summary, DELETE points `held`; zones list and delete `held`, create and update `on`.
- `GET/POST/PATCH/DELETE /travtrack/zones[/:id]` as the tag's `/location/zones` (PATCH, 409 `LOCATION_ZONE_HOLDS_POINTS` → resend with `deleteStoredPoints: true`). A paired device may read and write zones; a read-only PAT may only read.

- [ ] **Step 1: Failing tests** — from the tag: "takes positions only from a paired device with write access"; "refuses an empty or oversized envelope"; "reads a span in pages that never end silently, and only the owner's"; "deletes whole days on the profile's clock, both ends inclusive"; "goes with the account"; zones: "lets the paired phone read and write zones, but not a read-only token"; "keeps zones to their owner". New: "points queued before a switch to provider none are still accepted (201)"; "403 TRAVTRACK_DISABLED once the admin switches TravTrack off — and nothing is stored"; "with TravTrack off, an account holding data can still read its summary and delete a range and a zone, but cannot add a zone"; "the page carries purpose and entries"; "the summary never names a privacy zone's points or a gap inside a zone".
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
- `providerFor(userId): Promise<LocationProvider | null>` — by `getLocationProvider`: `travtrack` + `ok` (which already requires the instance on — derivations are `on`-tier, Review Focus 14) → TravTrack; `dawarich` + `ok` → Dawarich with the **user-tier** connection only; anything else → null.
- Explicit pulls ("aus Dawarich holen" for a tour or cruise) call `dawarichProvider(getDawarichConnection(userId))` directly, whatever the provider (unchanged behaviour).
- **Not moved in phase 2:** the stay scan (`dawarich/stays/window.ts`, which keys suggestions on Dawarich's numeric point ids), market visits inside it, and the country-day sweep keep their direct `DawarichClient` reads and S3's `dawarich`-only selection. They move onto `providerFor` in phase 3, together with the TravTrack suggestions that give them a second source; moving them now changes nothing a user sees and risks Review Focus 1.

- [ ] **Step 1: Failing tests** — from the tag's `locationSource.test.ts` "the internal reader": "answers a window ascending with string refs" (half-open now), "pages with a cursor instead of dropping the oldest". `dawarichProvider`: "an inclusive Dawarich window is read for a half-open request"; "a truncated read says truncated and offers no cursor"; "an unreachable Dawarich answers unreachable, it does not throw". `resolveProvider`: "none → null"; "dawarich with only the admin-global connection → null" (privacy boundary); "travtrack while the instance is off → null". `historyPoints` (from the tag, rewritten): "a trip reads its share of TravTrack points per device, minus the flight window"; "a Dawarich provider's points come back with coverage, truncated said as truncated"; "a point held both in a #316 batch and in TravTrack is shown once". Tour pull: "pull from Dawarich works for a provider-travtrack user with an own connection".
- [ ] **Step 2–4:** Run `npx jest locationProvider historyPoints pullDawarichTrack --forceExit` → FAIL, implement, → PASS; existing `dawarich*` suites unchanged and green.
- [ ] **Step 5:** Commit `feat(location): one read interface for TravTrack and Dawarich`.

### Task T5: Entry tracks from the provider — and the capability flip

**Files:**
- Create: `backend/src/services/locationProvider/entryTrack.ts`
- Create: `backend/src/services/travtrack/privacyCut.ts` (+ test)
- Modify: `backend/src/routes/flights/track.ts` (`GET /flights/:id/track`), `backend/src/routes/flights/trackLines.ts` (`GET /flights/track-lines`), `backend/src/routes/trips/tripRecording.ts` (`loadDevices`, `GET /trips/:id/recording` and `/gpx`), `backend/src/services/locationProvider/capabilities.ts` (the flip), OpenAPI paths for both GETs, `frontend` flight + trip track views (origin label, coverage note, source toggle), `i18n/resources/{de,en}/{flights,trips}.json`
- Tests: `backend/src/services/locationProvider/__tests__/entryTrack.test.ts`, `backend/src/routes/__tests__/flightTrack.provider.test.ts`, `backend/src/routes/__tests__/tripRecording.provider.test.ts`, `routes/__tests__/locationCapabilities.test.ts` (flip), web tests for the label and toggle

**Interfaces:**
- `entryTrack(userId, entry: { kind: "flight" | "trip"; id: string }, opts?: { source?: "travstats" | "travtrack" | "dawarich" }): Promise<{ origin: "travstats" | "travtrack" | "dawarich" | null; coverage: Coverage | null; alternatives: Array<"travstats" | "travtrack" | "dawarich">; devices: Array<{ deviceId: string | null; points: StoredPoint[] }> }>` — **per device, never flattened**: TravTrack points keep `device_id`, Dawarich points come back as one `deviceId: null` device, own batches as today. The trip route feeds `devices` into the existing `pointsByDevice` / `withoutJitter` / `rawSegments` path (`loadDevices` keeps its shape), so two phones on one trip stay two lines on the map and two sets of `<trkseg>` in the GPX.
  - Default: an own `FlightTrack` / `TripRecordingBatch` exists → `origin: "travstats"`, whatever the provider (existing recordings keep showing after any switch). Otherwise `providerFor(userId)`.
  - TravTrack for an entry = points **linked** to it ∪ points inside its window (flight: `recorderWindow`; trip: `tripRecordingBounds`, flight windows classified `inFlight` as today, so they stay a break), deduped by point id. Links keep a fix recorded for a delayed flight; the window catches everyday fixes.
  - Dawarich for an entry = the window, through `dawarichProvider`.
  - `alternatives` lists other sources that hold something for the window; `?source=` picks one explicitly (an extra view, never a silent swap). An unknown or empty source → 404 `TRACK_SOURCE_NOT_AVAILABLE`.
- Segments: the existing gap cut, plus the **final-output privacy check** `privacyCut(lines: [lon, lat][][], zones, opts?: { homeM?: number; home?: { lat; lon } }): [lon, lat][][]` (`services/travtrack/privacyCut.ts`), run on the geometry as it LEAVES the server — after jitter removal and after any simplification, never before: drop every vertex inside a zone (or within `homeM` of home), and break the line wherever a chord between two consecutive output vertices passes within a zone or the home circle (`segmentCrossesZone(a, b, circle)`, distance from the centre to the great-circle segment ≤ radius, sampled for chords over 50 km). Simplification can create a chord that the raw points never had; checking only the input would miss it. T6 and T7 use the same function on their output.
- `GET /flights/:id/track` → `{ track, origin, coverage, alternatives }` (additive; `track` keeps its shape).
- `GET /flights/track-lines` (`routes/flights/trackLines.ts`, which today reads only `prisma.flightTrack`) joins the replacement reads: for a flight without an own `FlightTrack` and provider `travtrack`, its TravTrack line (links ∪ window, simplified, `privacyCut`) is added with `origin: "travtrack"`; every line carries `origin`. Dawarich lines are NOT fetched for this map-wide read — one remote window per flight on every map load is a fan-out the map must not wait on; those flights keep their great circle on the map and show the Dawarich track on their own page. One query for the TravTrack lines (points of all the user's flight windows), not one per flight. `GET /trips/:id/recording` → `summary.origin`, `summary.coverage`, `summary.alternatives` added; `?source=` on both and on the GPX.
- **The flip** (`capabilities.ts`, Codex's sequencing rule): `capture.flight = (kind === "none" || kind === "travtrack") && flightLiveTrackingEnabled`, same for `trip`; new field `capture.sink: "entries" | "travtrack" | null` — `travtrack` when `kind === "travtrack" && status === "ok"`, `entries` for `none`, `null` when nothing is recorded. Same commit as the Dawarich reads, so a `dawarich` user stops recording exactly when Dawarich tracks appear on the flight and trip pages. Update the module comment and ADR pointer.

- [ ] **Step 1: Failing tests** — `entryTrack`: "an own recording stays the default after a switch to dawarich, labelled travstats"; "no own recording and provider dawarich → the window from Dawarich, coverage carried"; "no own recording and provider travtrack → linked and window points, once each"; "a fix linked to a delayed flight outside its scheduled window still shows"; "the trip track keeps the flight window as a break"; "two fixes on either side of a privacy zone, two minutes apart, are two segments"; "a simplified line whose new chord crosses a zone is broken there" (`privacyCut` on output); "two phones on one trip stay two devices in the map answer and in the GPX"; "track-lines draws a TravTrack flight from its points and marks origin"; "track-lines draws a Dawarich user's flight as before (no line, great circle) and makes no Dawarich request"; "?source=dawarich on an entry with an own recording shows Dawarich and says so"; "a Dawarich timeout answers coverage unreachable with the own recording untouched". Capabilities: "provider dawarich: capture.flight and capture.trip false, sink null"; "provider travtrack: both true with sink travtrack"; "provider none: sink entries". Web: the "TravStats-Aufzeichnung" / "aus TravTrack" / "aus Dawarich" label, the truncated/unreachable note, the toggle only when `alternatives` is non-empty.
- [ ] **Step 2–4:** Run `npx jest entryTrack privacyCut flightTrack.provider trackLines tripRecording locationCapabilities openapi --forceExit` and `npx vitest --run FlightTrack TripRecording` → FAIL, implement, → PASS.
- [ ] **Step 5:** Commit `feat(location): flight and trip tracks from the chosen source; Dawarich users stop recording`.

### Task T6: Web — `/track` and the TravTrack settings

**Files:**
- Create (server): `backend/src/routes/travtrack/day.ts` (`GET /travtrack/day`), `backend/src/routes/travtrack/export.ts` (`GET /travtrack/export`), `backend/src/services/travtrack/dayView.ts`, `backend/src/services/travtrack/exportFormats.ts` (GPX via `services/tripRecording/gpx.ts`, JSON)
- Create (web): `frontend/src/pages/Track/TrackPage.tsx` (+ `TrackDayMap.tsx`, `TrackTimeline.tsx`, `TrackCoverageBar.tsx`, `TrackExportDialog.tsx`, `TrackDeleteDialog.tsx`), `frontend/src/hooks/useTravTrackVisible.ts`, `frontend/src/components/Settings/TravTrackSection.tsx` (ported from the tag's `LocationHistorySection.tsx`: summary, zones, delete by days — without the source switch and without `TransferNotes`), `frontend/src/lib/api/travtrack.ts` (extend T1's; port of `lib/api/locationHistory.ts` minus source/transfer), `i18n/resources/{de,en}/track.json`
- Modify: `frontend/src/App.tsx` (routes `/track`, `/track/:date`), `frontend/src/components/Nav/useNavItems.ts` (collections group, entry "Track"), `pages/Settings/settingsModel.ts` (TravTrack section under "location", after `LocationProviderSection`)
- Tests: `backend/src/routes/__tests__/travtrack.day.test.ts`, `travtrack.export.test.ts`; Vitest `TrackPage.test.tsx`, `TrackCoverageBar.test.tsx`, `TravTrackSection.test.tsx` (ported), `useTravTrackVisible.test.ts`

**Interfaces:**
- `GET /travtrack/day?date=YYYY-MM-DD` (`on` tier; profile clock) → `{ date, zone, segments: StoredPoint[][], coverage: Array<{ fromMs; untilMs; state: "recorded" | "noData" | "deleted" | "phonePaused" }>, context: Array<{ kind: "flight" | "trip" | "home"; id: string | null; label: string; fromMs: number; untilMs: number }>, pointCount }`. Context from TravStats: the day's flights (scheduled/actual window), trips spanning the day, and stretches within 300 m of `user_settings.home_place`. "phonePaused" comes from `travtrack_gaps`; a privacy zone never appears as a state.
- `GET /travtrack/export?from&to&format=gpx|json` (`held` tier) — GPX one `<trkseg>` per segment; JSON `{ version: 1, origin: "travtrack", coverage, points: [...], gaps, deletedRanges }`. Bounded to 366 days per request (400 otherwise).
- `useTravTrackVisible()` = `isFeatureVisible("travTrack")` AND `/travtrack/capabilities` `enabled` AND (`active` OR `hasData`); fails closed while pending. That is the `/track` menu entry and page only. `TravTrackSection` in Settings shows whenever `hasData` (or `enabled`), so with TravTrack switched off an account still sees its summary, can export and can delete (Review Focus 14); its zone add form shows only while `enabled`.
- Day geometry and the GPX export go through `privacyCut` (T5) on their final output.
- Page (prototype board "Track-Tag"): day picker, map (MapLibre, line by segment, no dots at world zoom), timeline with context labels, coverage bar, zones overlay (own zones only), "Exportieren" (GPX/JSON), "Zeitraum löschen" (confirm names the count from `/travtrack/summary`-style preview, then `DELETE /travtrack/points?fromDay&toDay`). Every failure maps a code to DE/EN copy (`TRAVTRACK_DISABLED`, `LOCATION_ZONE_HOLDS_POINTS`, network).

- [ ] **Step 1: Failing tests** — server: "a day on the profile clock, with flights, trip and home as context"; "a reported gap is phonePaused, a deleted range is deleted, nothing marks a zone"; "export GPX and JSON carry origin and coverage, only the owner's"; "a span over 366 days is refused". Web: "the menu entry appears only with the beta key, the instance on and provider travtrack or data"; "the day shows segments and labels them from TravStats context"; "delete asks with the count and refreshes the day"; "TRAVTRACK_DISABLED shows its copy, not an empty map"; "with TravTrack off and data held, Settings still offers summary, export and delete, and no zone add"; "the menu entry is hidden with TravTrack off, even with data"; ported `TravTrackSection` cases ("says what is stored, and that nothing is"; "asks before a new zone deletes stored positions, then adds it"; "names coordinates it cannot read and adds nothing"; "removes a zone after confirmation"; "deletes the chosen days after confirmation and says how many") — the source and transfer cases are dropped.
- [ ] **Step 2–4:** FAIL → implement → PASS; `localeKeyParity` green; `npm run check:size`.
- [ ] **Step 5:** Browser look (dev stack + seeded TravTrack points): map, coverage bar, delete. Commit `feat(travtrack): the day view on the web`.

### Task T7: Export, backup and the shared-trip snapshot

**Files:**
- Modify: `backend/src/services/export/allDataExport.ts` (a `travtrack` section built by `buildTravTrackExport(userId)`, paged in 5000s: points with links, zones, deleted ranges, gaps; not in `USER_EXPORT_SELECT` so a million points are not one Prisma read), `backend/src/services/travtrack/deleteRange.ts` (registers the snapshot handler on `onPointsRemoved`)
- Create: `backend/src/services/travtrack/shareSnapshot.ts`, `backend/src/routes/travtrack/shareSnapshot.ts`; web toggle in the trip share dialog ("Route mitteilen" / "Share the route")
- Tests: `backend/src/services/travtrack/__tests__/shareSnapshot.test.ts`, extend `routes/admin/__tests__/exportAllData.test.ts`, `services/backup/__tests__/backupService.test.ts` (or a new `travtrack.backup.test.ts`), `routes/__tests__/tripRecording.private.test.ts` (stays green)

**Interfaces:**
- Backup is the whole-database `pg_dump`, so the tables are in it already; the test pins that no `--exclude-table` names a `travtrack_*` table and that a restore keeps `seq` (sequence restored).
- `buildShareSnapshot(userId, tripId): Promise<{ version: number; geometry: [lon, lat][][]; pointCount }>` — the trip's TravTrack entry track (T5): inside the trip window only, no timestamps (geometry only), simplified to ≤ 2000 vertices, and THEN `privacyCut(geometry, zones, { home, homeM: 1000 })` on that final geometry — vertices inside a zone or near home dropped and the line broken wherever a chord passes through one. Stored in `travtrack_share_snapshots` with `version` raised on each rebuild.
- T7 registers on `onPointsRemoved` (T2) — **as built after Codex's review (2026-10-25):** the stored geometry is `[lon, lat, tMs][][]` (the time never leaves the server) and is the ceiling. Every removal, a home change and a trip PATCH only NARROW it in place (`services/travtrack/shareNarrow.ts`): vertices outside the overlap of the stored window and the trip's current days, inside a deleted span or a current flight's window, or inside a zone, former zone or any home since the share go; lines break where a cut falls between two vertices; written with `updateMany`/`deleteMany` on id + version only. A snapshot stored without vertex times serves nothing until the owner shares again. **Restrictions are monotonic and atomic (Codex review, second round):** database triggers record, in the transaction of the change itself and whatever path it takes, every former home (`user_settings`), every span the trip's days had (`trips`) and every flight of the trip as it was before it was changed, moved, cancelled or deleted (`flights`), and — for a trip without a zone of its own, whose days are read on the profile clock — every span with the profile zone in force when it was recorded, plus the trip's span in the zone it leaves whenever the profile zone changes or the settings row is deleted or created (`user_settings`; a recorded span is read in its recorded zone, never today's, and the stored window is the instants resolved at share time) against the stored route (`travtrack_share_past_spans` / `_flights` / `_homes`); each table holds one row per distinct restriction (an md5 of the values that decide it; a repeat lands on that row and draws it a new record number from one sequence, `ON CONFLICT DO UPDATE SET recorded_seq`), and the flight trigger fires only when a value that places the recorder window changes — the scheduled ends with their semantics, zones, precisions and airports, the trip, the owner or the status; provider readings (actual, runway, check-in) are not recorded — so a recipient's replay is bounded by distinct restrictions, not by writes; every read and every narrowing applies them on top of the rules in force, so widening the days, removing a flight or clearing the home never shows more again. The home PUT and the trip PATCH narrow in their own transaction under the TravTrack lock, and a failed narrowing fails the change (nothing is swallowed). Only the owner's new share clears the records — and only those recorded before its build read its inputs (it reads their ids with their record numbers first, and deletes a row only while its number is still the one it read, so a repeat recorded during the build survives it — Codex review, fourth round): a flight, trip or settings write does not take the TravTrack lock, so a restriction recorded while the build runs stays and narrows the new share too; a first share commits a pending row (`version` 0, serves nothing, never narrowed, not shown to the owner) before the build so the triggers have a row to record such a change against (Codex review, third round); the row carries the token of the share that committed it, a failed build removes it only under the TravTrack lock and only if it still carries its own token, and a build that finds the row gone when it takes the lock commits it again before reading anything (`TRAVTRACK_SHARE_BUSY` after three tries) — so two first shares at once, one failing, never leave the other building without a row (Codex review, fourth round). **Revocation wins (Codex review P1, 2026-10-25):** the revoke takes the TravTrack lock, so it waits for a build that has read its row and then removes what it stored; the build's one write is an `updateMany` of the row it read at the version and pending token it read — never an upsert — so a row removed meanwhile by any other path (trip or account deletion, a narrowing that emptied it) is not written back and the share answers `TRAVTRACK_SHARE_REVOKED` (409, said in DE/EN, the dialog then shows the route as not shared); a row that only moved on (a narrowing raised its version) is built again (`TRAVTRACK_SHARE_BUSY` after three tries). Pinned in `travtrack.shareRevoke.test.ts`. A recipient's map asks for shared routes wherever TravTrack is on on the instance, whatever the reader's own provider or data.
- `PUT /trips/:id/share-snapshot` (owner, write scope) builds or rebuilds; `DELETE` revokes; a recipient's linked copy reads it through the trip's share membership (`services/sharing/members.ts`) at `GET /trips/:id/shared-route` → `{ routes: [{ version, sharedBy, geometry }] }` or 404 — the stored geometry narrowed at read time, no raw point read, rate-limited per reader. A trip delete cascades.
- Own recordings stay private exactly as `tripRecording.private.test.ts` pins: no snapshot unless the owner asks for one; never in a `.travstats` file, public link, comparison or federation.

- [ ] **Step 1: Failing tests** — "the account export carries TravTrack points with their links, zones, deleted ranges and gaps"; "a backup excludes no travtrack table"; "a snapshot holds geometry only, nothing near home, nothing inside a zone, nothing outside the trip"; "a rebuild raises the version"; "revoking removes it for every recipient"; "deleting a range over the trip rebuilds the snapshot without it, and removes it when nothing is left"; "a new zone over a shared route rebuilds the snapshot without that part"; "a zone that holds no stored point but lies under a chord of the snapshot still breaks it"; "simplification never leaves a chord across a zone or the home circle in the snapshot"; "the export answers with TravTrack off for an account holding data"; "a recipient reads the snapshot, never the points"; "no snapshot exists until the owner shares the route".
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
- Modify: `app/src/lib/location/capabilities.ts` (sanitize `capture.sink`, `travTrack.capture`, `travTrack.upload`; `travTrackSink(caps)` for starting, `travTrackUpload(caps)` for sending), `app/src/lib/server/api/location.ts` (`uploadTravTrackPoints` → `POST /travtrack/points`, gaps included; zones → `/travtrack/zones`), `app/src/lib/location/route.ts` (the route is known from the capabilities — `present` iff `caps.travTrack.upload`, NOT `enabled`/`capture`: points queued for TravTrack keep leaving the phone after a switch to `none` or `dawarich` while the server takes them; the OpenAPI probe for `/location/points` goes, that path never shipped), `app/src/lib/flight-track/record-fix.ts`, `app/src/lib/flight-track/raw-backfill.ts`, `app/src/lib/flight-track/store.ts` (provenance), `app/src/lib/location/queue.ts`, `app/src/lib/location/collect.ts`, `app/src/lib/location/upload.ts`, `app/src/lib/location/privacy-zones.ts`, `app/src/lib/location/hold.ts`, `app/src/lib/flight-track/background.ts` + `trip-track/background.ts` (`sink` on the armed state), `app/src/lib/flight-track/upload.ts` + `background-upload.ts` (skip `sink: 'travtrack'` tracks)
- Tests: the existing `__tests__` of each, plus `lib/location/__tests__/sink.test.ts`

**Interfaces:**
- `QueuedPoint` gains `purpose: 'everyday' | 'flight' | 'trip'` and `entries: Array<{ kind: 'flight' | 'trip'; id: string }>`; `enqueueLocations` merges the entries of a fix already in the open batch (same `fixId`) instead of dropping the second hand-over.
- `EnvelopeTarget` gains `{ kind: 'travtrack' }`; `QueueRoute` gains `'travtrack'`. Envelopes already frozen keep their target (`trip` envelopes queued under `none` still go to `/trips/:id/recording`). Unsent `{ kind: 'points' }` batches of phase 1 are taken by the `travtrack` route once it is present.
- `FlightArmed.sink` / `TripArmed.sink`: `'entries' | 'travtrack'`, frozen when the purpose is armed from `capture.sink`. The armed state is gone after landing, disarm or an app restart, while `FlightTracks` (`Record<string, TrackPoint[]>`) is enumerated by the uploader long after — so the sink is **persisted per stored track**: `STORE_KEYS.flightTrackProvenance: Record<flightId, { sink: 'entries' | 'travtrack'; armId: string; sinceMs: number }>`, written in the same serialized write that stores the track's first point, removed with the track (`withoutFlights`, retention, account wipe). The uploader, `record-fix.ts`, `raw-backfill.ts` and `hold.ts` read the provenance, never the armed state. **Upgrade default:** a stored track without a provenance entry (recorded before this update) is `sink: 'entries'` — uploaded to `POST /flights/:id/track` exactly as before. A `travtrack` flight still records its local track for the phone's screen but the flight-track uploader skips it; a `travtrack` trip files fixes with `entries` and target `travtrack`, never `tripId` for `/trips/:id/recording`. So no entry gets both an own track and history points.
- **Raw fixes and the backfill copy nothing on a switch.** `recordFlightFixes` (`record-fix.ts`) queues a flight's raw fixes into the location queue only when that flight's provenance is `travtrack` (then they ARE its record, with `purpose: 'flight'`, `entries: [{ kind: 'flight', id }]`), plus the everyday case of C7. `backfillLegacyFlightFixes` (`raw-backfill.ts`) and `releaseHeldFixes` (`hold.ts`) take only fixes of tracks whose provenance is `travtrack`; a track recorded under `entries` (before or after the switch) is never copied into TravTrack — rule 2, "switching copies nothing".
- **Which gates apply under the `travtrack` sink** (`collectFixes(points, { source, session, sink })`): the server's capture decision (`capture.flight` / `capture.trip` / `capture.everyday`, which already folds the account's switches in), privacy zones, and the C7 mode — nothing else. The entry routes' switches are NOT read for TravTrack fixes: `readTripRecordingSwitch()` (the `/trips/:id/recording` switch, which made `collectFixes` answer `switchedOff` for everything) and `flightTrackSend` („Flugwege an den Server senden", which answered `notSending`) apply to `sink: 'entries'` only; under `travtrack` the screen hides that toggle. A valid TravTrack fix therefore never ends phone-only because of an entry-route switch. Under `sink: 'entries'` everything stays exactly as today.
- Upload answers: `TRAVTRACK_DISABLED` (403) → state `{ kind: 'travTrackOff' }`, batch kept, `RETRY_LATER_MS` (and `travTrack.upload` false in the next capabilities read stops trying until it is true again); `TRAVTRACK_DEVICE_REQUIRED` → `refused`; the T2 outcome counts (`unlinked`) are counted in `stats.ts`.
- Zones: `refreshPrivacyZones` against `/travtrack/zones` on foreground, on opening the location screen, and before a TravTrack purpose starts; `STORE_KEYS.privacyZonesFetchedAt`. **Stale or unknown zones are handled conservatively:** a list once fetched keeps filtering however old (a zone never lapses offline; the server drops what a newer zone covers). With no list ever fetched for this account, TravTrack fixes are held (`hold.ts`) and released through the zone filter once a list arrives; nothing leaves the phone before. Each such hold, a watchdog revive after silence (`recorderSilent`) and a missing „Immer" permission (`permission`) is kept as a gap in `STORE_KEYS.travTrackGaps` (internally `{ fromMs, toMs, reason }`), sent as `{ from, to, reason }` ISO instants (the T2 contract). Gaps ride in the next points envelope; with no points waiting the uploader sends a **gap-only envelope** under its own frozen `uploadId` (the queue's envelope protocol, `points: []`). A gap leaves the phone only once the server answered.

- [ ] **Step 1: Failing tests** — "under sink travtrack a trip's fix is queued with purpose trip and the trip in entries, target travtrack"; "the same fix from the flight and the trip recorder is one queued point with both entries"; "a trip envelope queued under none still goes to /trips/:id/recording after the switch"; "a travtrack flight's track is recorded but never uploaded to /flights/:id/track"; "403 TRAVTRACK_DISABLED keeps the batch and says so"; "no zone list yet: fixes are held and nothing is sent; the list arrives and the held fixes inside a zone never leave the phone"; "an old zone list keeps filtering offline"; "a held stretch and a revive are sent as gaps"; "gaps with nothing else waiting go as a gap-only envelope and are settled by its answer"; "queued TravTrack points still upload after a switch to dawarich while travTrack.upload is true, and wait when it is false"; "a travtrack flight's track is not uploaded after landing, after a disarm and after an app restart" (provenance, not armed state); "a stored track without provenance uploads to /flights/:id/track as before"; "switching to travtrack copies no fix of an earlier entry recording into the queue — record-fix, raw-backfill and the held fixes alike"; "under the travtrack sink a trip fix is queued although the old trip-recording switch is off and Flugwege senden is off"; "under the entries sink both switches still stop collection as today"; "another account's zones and queue are never read" (account-session tests stay green); "legacy and phase-1 servers: everything as before" (existing cases).
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

**Status 2026-10-26:** builds out (owner OK) — TestFlight build 61 (0.1.0, internal group only) and a release APK on the owner's Xiaomi, both from `feat/travtrack-p2` @ 839d98a5 against CT 106. The field day itself runs on the owner's time.

**Prod, 2026-10-26 (owner OK):** the owner's account on prod has the privacy zone „Zuhause" (250 m, as on the beta), and his Dawarich history 2006-10-01…2026-10-26 was copied into TravTrack (391,075 + 9,042 points stored, 825 dropped by the zone, 0 errors). Since then his iPhone records with TravTrack (build 66) and Dawarich side by side. Two binding consequences:

- **No Dawarich copy runs for any day from 2026-10-26 on.** Those days already arrive through TravTrack; a copy would store every way twice.
- **Battery per hour does not count on those days** — two recorders run at once.

The iOS reference comparison (TravTrack vs Dawarich for 2026-10-26 and 2026-10-27, from both APIs) is done by the Companion session on 2026-10-28 and recorded under Step 4.

- [ ] **Step 1:** Android (the Xiaomi from P0) and iPhone, one ordinary day on **Alltag** with a short trip and a flight-mode simulation: one notification at a time; the rate rises and falls in place.
- [ ] **Step 2:** The P0 failure modes on purpose: swipe away, `adb shell am crash`, reboot, permission downgrade to „Beim Verwenden". Expected: each silence ends at the next app start or background task (watchdog), and each one appears on `/track` as „Telefon pausiert" — never as recorded, never unexplained.
- [ ] **Step 3:** Measure battery per hour unplugged, fixes per hour, share ≤ 20 m, upload delay; a privacy zone at home: no fix inside it on the server, no gap shown for it.
- [ ] **Step 4:** Record numbers and verdict in ADR 0016. Owner decides whether `travTrack`'s `returnsWhen` is met.

### Task C9: Companion — start and stop Alltag from Shortcuts (owner, 2026-10-26)

The owner's Dawarich routine, carried over: an iOS Shortcuts automation STARTS
recording when he leaves home and STOPS it when he arrives, and points go up on
an interval. TravTrack has to work the same way.

**Order (binding):** (1) a test build of `feat/travtrack-p2` against the Beta
(CT 106, `2.7.0-beta.26`, TravTrack on), (2) C8 on that build, (3) C9 on top of
`feat/travtrack-p2` as `feat/travtrack-shortcuts`. Until (1) the owner's phone
records nothing into TravTrack, so it comes first. Every build that leaves
lisbeth — APK for testers, TestFlight, store — only with the owner's OK.

**Contract: unchanged.** `POST /travtrack/points` (points, gaps), `/travtrack/zones`,
`/location/capabilities` as in phase 2; no server work. A deliberate stop sends
**no gap**: the span reads as "keine Daten" on `/track`, which is what it is, and
for the stretch at home it is also the more private answer. A dedicated gap
reason (`stopped`) was considered and not added — the server rejects an unknown
reason with 400, so the phone would need a capability check for it, for no
benefit the owner asked for. Revisit only on the owner's wish.

**Files (Companion):**
- Create: an App Intents target (`StartTravTrackIntent`, `StopTravTrackIntent`, `openAppWhenRun = false` where the device check allows it) via a config plugin, `app/src/lib/location/shortcut-control.ts` (the one entry both the intents and the URL take), `adrs/0017-travtrack-shortcuts.md`
- Modify: `app/src/app/+native-intent.ts` (`travstats://travtrack/start`, `travstats://travtrack/stop`), `app/src/lib/location/coordinator.ts` + `capture-plan.ts` (a deliberate stop), the watchdog, `app/src/lib/location/upload.ts` (interval setting, flush), `app/src/app/settings/location.tsx`, `app/src/components/location/copy.ts` (DE + EN)

**Interfaces:**
- `startEveryday()` / `stopEveryday()` in `shortcut-control.ts` set `STORE_KEYS.everydayCapture` and run `syncCapture`. Each returns one result the action shows (Upload: see the third action below): `running` „läuft" / "running", `stopped` „gestoppt" / "stopped", `travTrackOff` „TravTrack am Server aus" / "TravTrack is off on the server", `permission` „Immer-Berechtigung fehlt" / "'Always' permission missing", `notPaired` „nicht gekoppelt" / "not paired". Start checks pairing, `captureDecision(caps, 'everyday')` and the „Immer" grant before it reports `running`.
- **The Dawarich iOS pattern, adopted (owner, 2026-10-26: „Festhalten und so bauen").** Dawarich's iOS app offers Start Tracking, Stop Tracking and Upload Points in Shortcuts. Its documented weakness is that a Shortcuts start "may fail without opening the app first" (users open the app daily; tracking sleeps after a long stay), a swipe from the app switcher stops it, and it uploads in batches of 100 while tracking plus the rest on stop. C9 follows it: **Start opens the app briefly** (`openAppWhenRun = true`), because iOS starts background location reliably only from the foreground; whether iOS 26 can start it without opening the app (App Intents `supportedModes`) is measured on the device and recorded in ADR 0017. **Stop and Upload run without opening the app.**
- **Third action „TravTrack hochladen" / "Upload TravTrack":** sends the queue at once and answers with the result — `sent` (N points), `nothingWaiting`, `offline`, `travTrackOff`.
- **iOS safety net:** with the task, expo-location also starts significant-change monitoring, so iOS relaunches the app after a pause or a kill; since `bd4b265c` the capture task is defined on a background start. Whether this also holds after a swipe-kill is measured on the device (ADR 0017).
- **Every action answers honestly** — no action fails silently.
- **A stop is deliberate:** the watchdog does not revive a purpose stopped by the user, and no `recorderSilent` gap is written for that span. Flight and trip purposes are untouched by start/stop — an armed flight keeps recording through a stop (precedence of C7 unchanged).
- **Upload interval:** `RECORDER_SEND_EVERY_MS` becomes the setting `STORE_KEYS.travTrackSendEveryMs`, one of 5 / 15 / 30 / 60 min, default 15. The last send time is persisted (`STORE_KEYS.travTrackLastSentAt`), so the interval survives a restart. A stop sends the open queue at once (the envelope protocol and its frozen `uploadId` as before).
- **Settings, under Alltag:** „Per Kurzbefehl steuerbar" / "Can be controlled by Shortcuts" with a short guide (the two actions, a Home automation as the example), the interval picker and „Zuletzt gesendet" / "Last sent".
- **Android:** the URLs `travstats://travtrack/start|stop|upload` work from Tasker/MacroDroid as a VIEW intent — no extra code, no exported receiver.
- **As built (`feat/travtrack-shortcuts` @ 43f5a616):** the links carry a per-phone key (`?key=…`, shown under Alltag on Android); a link without the right key runs nothing. Added after a security review: any web page can open a custom-scheme link, so an unkeyed start/stop was a CSRF. Answers: running, stopped, openApp, notStarted, travTrackOff, permission, paused, notPaired, sent N, nothingWaiting, offline. Android verified on the Xiaomi (ADR 0017); the iOS device check needs a TestFlight build.
- **Not built (owner decision first):** the same without Shortcuts, through an in-app geofence around `user_settings.home_place`.

- [ ] **Step 1: Failing tests** — "the start intent and the start URL both switch Alltag on and answer running"; "upload sends the queue and answers sent N / nothingWaiting / offline / travTrackOff"; "stop switches only Alltag off and answers stopped"; "after a stop the watchdog does not revive Alltag and no recorderSilent gap is queued"; "a stop sends the open queue at once"; "the interval setting and the last send time survive a restart"; "an armed flight keeps recording through a stop"; "unpaired answers notPaired, TravTrack off answers travTrackOff, a missing Immer answers permission — and nothing starts".
- [ ] **Step 2–4:** FAIL → implement → PASS; `npx tsc --noEmit`, `npm run test:time-zones`.
- [ ] **Step 5:** Device check on the iPhone (start and stop from a Shortcuts automation with the app closed), result in ADR 0017.
- [ ] **Step 6:** Commit `feat(location): start and stop everyday recording from Shortcuts`.

### After C9: capture scope (owner, 2026-10-26)

Start simple: **record everything is the default.** No manual accuracy setting and no per-type profiles yet; they come once there is field experience. The later concept — all sources, triggers and per-type profiles (flight, cruise, ferry, rail, bus, roadtrip, workout, everyday) — is the board at https://claude.ai/artifact/FS93X8kqman2wrCDEwZuLC.
Decided for the RC (owner, 2026-10-26; app `rc/companion-2026-10-26` @ eb7ab784, ADR 0016 amended): the app's location screen offers only **Aus | Alles** (today's everyday mode, which already raises the rate for flights and trips); „Flug & Reise" is no longer offered. Contract unchanged — `capture.modes` still lists `trips` and `everyday`; the app just stops offering `trips`.

**iOS needs the Shortcuts (owner, 2026-10-26):** under „Alles" the iPhone screen shows „Kurzbefehle – auf dem iPhone nötig" with the two automation steps (leave home → start, arrive → stop) and the last run; ADR 0017 records it.

### Phase 2 exit

- [ ] Server gates (Build Checks) green on `dev/travtrack`; `npm run check:drift` green with the one TravTrack migration; Companion `tsc` + `npm test` + `test:time-zones` green.
- [ ] Codex review of both diffs since phase 1; findings fixed.
- [ ] Browser look at `/track` and the flight/trip origin labels; C8 recorded; C9's device check recorded in ADR 0017.
- [ ] Ask the owner, as a single question, whether phase 2 goes to `main` / an RC (still behind `travTrack`).

## Phase 3 — TravTrack helps TravStats

Written on 2026-10-25 against what Phase 2 built on `dev/travtrack` (`services/travtrack/{ingest,classify,zones,deleteRange,readSafe,privacyCut,privacyCircles,dayView,gaps,links,lock}.ts`, `services/locationProvider/{types,travtrackProvider,dawarichProvider,resolveProvider,entryTrack}.ts`, `routes/travtrack/*`) and on the direct Dawarich reads it left in place (review focus 13): `services/dawarich/stays/{scan,window,detect,review,coverage,suppression}.ts`, `services/dawarich/marketVisits/{integration,detect,pointGrid}.ts`, `services/dawarich/countryDaySweep.ts` + `services/countryDays/{reduce,store,countryDaySource}.ts`, `jobs/{dawarichStayScheduler,dawarichCountryDaySweepScheduler}.ts`. Revised the same day after Codex's review of the first draft.

**What changes for whom.**
- **Dawarich users: nothing** (owner rule; review focus 1, 17). Their stays, market/venue visits and country days stay byte-identical: the Dawarich detectors keep their legacy input path — `readStayWindow` (`stays/window.ts`, one read for a window ≤ 7 days, the per-day fallback when it truncates), `DawarichPoint` with numeric ids, today's fingerprint and evidence JSON, the country sweep and its cursors — with no new anomaly mask, no zone filter and no deleted-range filter on Dawarich reads, and no new re-check on their accept. The only Dawarich-side change is that each new stay row also records `provider`, `provider_rev`, `algorithm_version` and the neutral `evidence_key` in their own columns (E1); `evidence` and `fingerprint` are written exactly as today. No new inbox kind reaches them.
- **TravTrack users** get the same stay and venue cards from TravTrack, country and missing-journey questions in the inbox, labelled days, and two more sources (GPX files, OwnTracks/Overland). Rule 7 ("Companion only") is lifted here; `/travtrack/capabilities` gains `sources` (additive, version stays 1).

**Open owner decisions (not built):** (a) applying privacy zones to Dawarich-derived suggestions; (b) re-checking a Dawarich finding's evidence on accept; (c) country and journey questions for Dawarich users. Each changes what a Dawarich user sees, so each needs the owner's word.

**Where the code lives.** TravTrack provides points; turning points into a question is TravStats code (`services/locationEvidence/*`), and TravTrack never writes `place_visits`, `country_overrides`, journeys or trips — TravStats' accept handlers do, on the user's decision (rule 6), as the Dawarich stay accept does today. The stay finding table stays `dawarich_stays` (a rename Prisma cannot see is a hand-written migration with a replay obligation; separate refactor if wanted); it gains provider columns. New kinds (country, journey; phase 4 trip) go into one new table `location_suggestions`.

**TravTrack off.** When the instance's TravTrack is off (`travTrackInstanceOn()` false), **no TravTrack derivation runs**: no scheduled or manual stay scan from TravTrack, no country projection, no journey detection, and accepting a pending TravTrack suggestion answers 403 `TRAVTRACK_DISABLED` (rejecting still works — it writes nothing but the answer). Already accepted entries stay. Removals stay possible (the `held` tier) and their invalidation (E5) still runs inside the removal's transaction; dirty days queue up and are drained once TravTrack is on again. Dawarich derivations do not look at the TravTrack switch.

**Privacy rules every TravTrack task states and tests** (review focus 10, 15 carried forward):
- **Zones and tombstones.** Stored TravTrack points already exclude zones in force and former zones' circles (ingest drops, zone create deletes); new sources go through the same ingest (E8, E9, L6). A TravTrack candidate whose centroid, endpoint or line lies in a circle is not created; no explanation, label, count or coverage state names a zone.
- **Deleted ranges.** Ingest refuses points in a tombstone for every source; derivations read only stored points.
- **Deletion.** Every removal (`onPointsRemoved`) removes what was derived from the removed points in the same transaction, under the per-user TravTrack lock, and raises the account's history generation; a derivation that read before the removal cannot publish after it (E5's generation fence). Open suggestions vanish; accepted entries stay, their evidence stripped to a summary holding no position or digest from the deleted history.
- **Output.** Geometry that leaves the server goes through `privacyCut` on its final form (T5). Suggestions carry centroids, endpoints and lines for the owner's inbox only — never in a share, `.travstats` file, public link, comparison or federation payload; point digests never leave the server at all.

**Order.** E1 (migration, envelope, generation) first. E2 (TravTrack derivation read) before E3, E6, E7. E3 → E4 → E5 for stays; E5 also covers E6/E7 rows once they exist (its handler is extended in each). E6 and E7 are independent of each other. E8 (one ingest pipeline + GPX) before E9 (OwnTracks/Overland). E10 needs E7's entry-window adapters. No Companion task: the phone records exactly as in phase 2.

### Task E1: The evidence envelope, the history generation, one migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: migration `<ts>_location_evidence` (generated in a throw-away clone DB; `<ts>` after `20261024200938_travtrack`), `backend/src/__tests__/migration.locationEvidence.test.ts`
- Create: `backend/src/services/locationEvidence/{types,key,envelope,generation}.ts`
- Modify: `backend/src/services/countryDays/countryDaySource.ts` (`COUNTRY_DAY_SOURCES = ["dawarich", "travtrack"]`), `backend/src/services/stats/trackEvidence.ts` (`source: CountryDaySource` instead of the literal; Dawarich output unchanged), `middleware/errorHandler.ts` (`EVIDENCE_INVALIDATED`, `SUGGESTION_ALREADY_RESOLVED`, `SUGGESTION_ACCEPT_IN_PROGRESS`, `INGEST_TOKEN_INVALID`, `TRAVTRACK_IMPORT_NO_TIMES`, `TRAVTRACK_IMPORT_UNREADABLE`, `TRAVTRACK_IMPORT_RUNNING` into `ApiErrorCode`)
- Tests: `locationEvidence/__tests__/{key,envelope,generation}.test.ts`

**Schema (all in this one migration):**
- `dawarich_stays` + `provider String @default("dawarich")` (CHECK `dawarich|travtrack`), `provider_rev Int @default(0)`, `algorithm_version Int @default(0)` (0 = before versioning), `evidence_key String?`, `claim_token String?`, `claimed_at DateTime?`; index `(user_id, provider, status)`.
- `dawarich_stay_scans` + `provider String?` (the last scan's source; the row stays the one consent and lease per account).
- `place_visits` + `suggestion_ref String?` (the evidence key of the finding that made the visit; null for every existing visit).
- `location_suggestions` — `id uuid`, `user_id` FK cascade, `kind` (CHECK `country|journey`; L4 adds `trip`), `provider` (CHECK `dawarich|travtrack`), `provider_rev Int`, `algorithm Int`, `evidence_key`, `window_from`, `window_until`, `status` (CHECK `pending|accepting|accepted|rejected|invalidated`), `claim_token`, `claimed_at`, `explanation jsonb` (`{ code, params }`, never prose, never a coordinate), `evidence jsonb`, `accepted_entry_kind String?`, `accepted_entry_id String?` (no FK: polymorphic), `detected_at`, `resolved_at`. `UNIQUE (user_id, kind, evidence_key)`, index `(user_id, status, window_from)`.
- `travtrack_dirty_days` — `user_id`, `day Date`, `version BigInt` (raised on every re-mark), `done Int @default(0)` (bitmask of projections that ran on this `version`: 1 country days; L1 adds 2, L3 adds 4); `PRIMARY KEY (user_id, day)`.
- `travtrack_derivation_state` — `user_id` PK, `history_generation BigInt @default(0)`, `country_reducer_version Int`, `stay_algorithm Int`, `journey_algorithm Int`, `last_run_at`, `last_error_kind String?` (closed vocabulary, never a message).
- `travtrack_imports` (E8) and `travtrack_ingest_tokens` (E9) as defined there.

**Interfaces:**
```ts
type EvidenceProvider = "travtrack" | "dawarich";
type EvidenceSuggested = {
  id: string;
  kind: "stay" | "market" | "venue" | "country" | "journey";
  provider: { kind: EvidenceProvider; rev: number };
  window: { fromMs: number; untilMs: number };          // [from, until)
  algorithm: { name: "stay" | "market" | "country" | "journey"; version: number };
  explanation: { code: string; params: Record<string, number | string> };
  status: "pending" | "accepted" | "rejected" | "invalidated" | "covered" | "superseded";
  coverage: Coverage;                                   // T4's vocabulary
};                                                     // evidence_key and digests stay server-side
```
- `observationKey(o)` = `` `${Math.floor(o.atMs / 1000)}|${o.lon}|${o.lat}` `` — TravTrack's `positionKey`, and Dawarich's own dedup key (user + timestamp + lonlat, spec §10.1). **The neutral key replacing numeric point ids:** a fix has the same key read from Dawarich, from TravTrack, or copied from Dawarich into TravTrack (L6).
- `pointDigest(userId, key)` = HMAC-SHA256 under a **server secret** (derived with HKDF, label `travtrack-evidence-digest`, from the instance key in `utils/encryptionKey.ts`), cut to 16 bytes hex. Treated as sensitive: never in an API response, the account export, a log or a share; deleted with the history it came from (E5). TravTrack rows store digests in `evidence.pointDigests` (capped at 20 000, first and last kept); Dawarich rows keep `evidence.pointIds` exactly as today.
- `stayEvidenceKey(c)` = HMAC of `["stay", firstKey, lastKey, startMs, endMs, lat.toFixed(5), lon.toFixed(5)]` — provider-neutral; stored in `evidence_key` for both providers; for TravTrack rows also the `fingerprint`. Dawarich rows keep today's fingerprint.
- `historyGeneration(tx, userId)` / `bumpHistoryGeneration(tx, userId)` — the counter every TravTrack removal raises inside its transaction under `takeTravTrackLock` (E5); derivations capture it before reading and compare it when publishing (E3, E4, E6, E7).
- `toEnvelope(row)` — legacy rows (version 0) map to `algorithm.version 0`, explanation `{ code: "stay.legacy", params: {} }`.

- [ ] **Step 1: Failing tests** — `key.test.ts`: "a Dawarich point and a TravTrack point with the same second and coordinates have the same key"; "milliseconds do not change the key"; "a digest differs per account and per server secret"; "the stay key holds no provider id". `envelope.test.ts`: "a legacy Dawarich stay maps to version 0"; "the envelope carries no evidence key and no digest"; "every new explanation has a code and scalar params". `generation.test.ts`: "a bump inside a rolled-back transaction leaves the generation unchanged". **Upgrade test** `migration.locationEvidence.test.ts`: build the database at the **Phase 2 schema** (`migrate deploy` up to `20261024200938_travtrack`), insert rows in that shape — a pending and an accepted `dawarich_stays` row with `pointIds`, a `dawarich_stay_scans` row, a `place_visits` row, TravTrack points — apply this migration and assert: rows survive, `provider = 'dawarich'`, `algorithm_version = 0`, evidence JSON byte-identical, `suggestion_ref` null; the CHECKs refuse `provider='gps'` and `kind='stay'`; deleting the user removes every new row.
- [ ] **Step 2:** `cd backend && npx jest locationEvidence migration.locationEvidence --forceExit` → FAIL.
- [ ] **Step 3:** Generate the migration in the clone DB, apply to the shared dev DB with `migrate deploy`, implement the modules.
- [ ] **Step 4:** Tests + `npm run check:drift` + `npx jest trackEvidence passport countryDays --forceExit` (green, unchanged) → PASS.
- [ ] **Step 5:** Commit `feat(location): a provider-neutral evidence envelope, key and history generation`.

### Task E2: The TravTrack derivation read

TravTrack only. Dawarich keeps `readStayWindow` and the sweep's own reads unchanged.

**Files:**
- Create: `backend/src/services/locationEvidence/{derivationRead,anomaly,toDetectorInput}.ts`
- Tests: `locationEvidence/__tests__/{derivationRead,anomaly,toDetectorInput}.test.ts`

**Interfaces:**
- `readTravTrackDerivation(userId, window: ReadWindow, opts?: { isAllowed?: () => Promise<boolean>; maxPoints?: number /* 250_000, the stay window's cap */ }): Promise<{ points: DerivationPoint[]; coverage: Coverage; generation: bigint; cancelled: boolean }>`:
  - Captures `historyGeneration` **before** the first page (E5 compares it at publication).
  - Reads `travtrackProvider` pages to the end (cursor paging: TravTrack never truncates silently); stopping at `maxPoints` answers `coverage: "truncated"` with `next` kept, never a silently shortened window. `isAllowed()` between pages (the scan's lease and consent predicate).
  - **Anomalies** (`anomaly.ts`, Dawarich's thresholds, spec §10 point 1, per device): accuracy > 10 km, null island, same-second jump > 1 km, speed above `max(1000 km/h, 3 × median)`, runs of ≤ 5 points between two such jumps — masked, never deleted.
  - **In the air:** points in the account's flight windows (`recorderWindow`, as T5) carry `inFlight: true`.
  - Privacy: stored points already exclude zones and tombstones; the read adds no second filter and no Dawarich path.
- `DerivationPoint = LocationObservation & { key: string; digest: string; inFlight: boolean }`.
- `toDetectorInput(p: DerivationPoint)` — the explicit conversion to the shape the stay and market detectors take (`{ id: digest, timestampMs, latitude, longitude, altitude, accuracy, velocity, trackId: null }`), so the detectors keep their code and Dawarich keeps its `DawarichPoint`; `toTimedPosition(p)` — the country reducer's `TimedPosition` (E6). Both pure, both tested for unit conversions (m/s stays m/s; `courseDeg` dropped).

- [ ] **Step 1: Failing tests** — "a window larger than one page is read to the end, oldest first"; "stopping at maxPoints says truncated and keeps the cursor"; "the generation is captured before the first page"; "a frozen-fix teleport is masked, the points around it stay"; "a point inside a flight window is inFlight"; "isAllowed false between pages cancels"; "toDetectorInput keeps speed in m/s and uses the digest as id"; "nothing in this module imports the Dawarich client" (source scan).
- [ ] **Step 2–4:** `npx jest derivationRead anomaly toDetectorInput --forceExit` → FAIL, implement, → PASS.
- [ ] **Step 5:** Commit `feat(location): one filtered read of TravTrack for everything derived from it`.

### Task E3: Stays and market visits from TravTrack

Same detector, thresholds (150 m / 20 min, forgejo#294), suppression, coverage and market logic. The scan picks its source; the Dawarich branch is today's code path.

**Files:**
- Modify: `backend/src/services/dawarich/stays/scan.ts` (split: `scanSource.ts` resolves the source; `scanCandidates.ts` takes the per-candidate loop, so each file stays under 400 lines), `stays/detect.ts` and `marketVisits/{integration,detect,pointGrid}.ts` (point id type widened from `number` to `number | string` — Dawarich still passes numbers; no other change), `stays/availability.ts` (scheduled predicate = provider `dawarich`, OR provider `travtrack` AND instance on), `jobs/dawarichStayScheduler.ts` (same selection, in the query), `services/locationProvider/kinds.ts` (`STAY_SCAN_PROVIDER_WHERE`)
- Tests: the existing `stays/*`, `marketVisits/*`, scheduler and stay route suites green unchanged; new `stays/__tests__/scan.provider.test.ts` with a golden fixture

**Interfaces:**
- `staySource(userId, { scheduled })` → `{ kind: "dawarich"; client; rev } | { kind: "travtrack"; rev }`. Scheduled: by `getLocationProvider` (`dawarich` + ok → own connection; `travtrack` + ok + instance on → TravTrack; else refuse with today's `DAWARICH_SCAN_UNAVAILABLE`). "Scan now": provider `travtrack` → TravTrack, or 403 `TRAVTRACK_DISABLED` when the instance is off (nothing reserved); otherwise today's behaviour (own Dawarich connection, whatever the provider; 409 `DAWARICH_OWN_CONNECTION_REQUIRED`).
- **Dawarich branch:** `readStayWindow(client, …)` → `DawarichPoint[]` → detectors → rows written exactly as today, plus the columns `provider = 'dawarich'`, `provider_rev`, `algorithm_version = 0` (the legacy path is not re-versioned), `evidence_key`. The golden test compares every written field but those four.
- **TravTrack branch:** `readTravTrackDerivation` → `toDetectorInput` (in-flight and masked points removed) → detectors → rows with `provider = 'travtrack'`, `algorithm_version = STAY_ALGORITHM` (1), `fingerprint = evidence_key`, `evidence.pointDigests` (no `pointIds`), `evidence.source = "travtrack"`, `evidence.explanation = { code: "stay.dwell" | "market.visit" | "venue.visit", params: { minutes, points, radiusM, maxGapMinutes } }`. A candidate whose centroid lies in a privacy circle is skipped (`skippedPrivate`, counted, never logged with a position).
- **Cross-provider identity:** the interval/radius `known` match (unchanged, provider-agnostic) keeps a stop found in Dawarich from being suggested again from TravTrack; market fragment overlap ("shared ≥ 3 points") compares ids within one provider only (numbers with numbers, digests with digests); the area-containment half works across.
- **Publication fence:** every finding insert of a TravTrack scan runs in a transaction that takes `takeTravTrackLock(tx, userId)` and compares `historyGeneration` with the one the read captured; changed → the run stops, publishes nothing more, and is recorded `result: "stale"` (the next run reads afresh). Dawarich inserts are unchanged.
- **Bounded prompting:** a scan reads its window only (7 days scheduled, ≤ 30 by "scan now"); imports (E8, L6) never trigger a scan of their span; at most 20 new TravTrack findings per run (the rest wait for the next run, counted in the result).

- [ ] **Step 1: Failing tests** (`scan.provider.test.ts`, fake client / seeded TravTrack points, real DB): "golden: the Dawarich fixture yields the same rows as on main — every field but provider, provider_rev, algorithm_version and evidence_key" (review focus 1; fixture captured on `main` before editing); "a Dawarich scan applies no zone, no anomaly mask and no deleted-range filter" (a fixture point inside a TravTrack zone still counts, as today); "TravTrack points yield a stay with provider travtrack, rev and algorithm 1, digests and no pointIds"; "the same stop seen in Dawarich and later in TravTrack is one finding"; "a TravTrack stay inside a privacy circle is not suggested and the result does not name it"; "a range deleted while the scan ran: the scan publishes nothing after the delete and records stale"; "at most 20 new findings per run"; "the scheduler scans a travtrack account while the instance is on and skips it when off"; "the scheduler still skips provider none with an own connection" (S3); "scan now by a travtrack user with TravTrack off is 403 TRAVTRACK_DISABLED and reserves nothing"; "scan now by a provider-none user with an own connection reads Dawarich as before".
- [ ] **Step 2:** Capture the golden fixture on `main` (`GOLDEN_WRITE=1 npx jest scan.provider -t golden --forceExit`), then `npx jest dawarich/stays marketVisits dawarichStayScheduler scan.provider --forceExit` → FAIL.
- [ ] **Step 3–4:** Implement → PASS; `npm run check:size`.
- [ ] **Step 5:** Commit `feat(stays): stay and venue suggestions from TravTrack, Dawarich unchanged`.

### Task E4: Accepting a TravTrack suggestion — idempotent, re-checked, never self-evidence

Dawarich findings accept exactly as today (open decision (b)). Everything below applies to `provider = 'travtrack'` rows in `dawarich_stays` and to every `location_suggestions` row (E6, E7 reuse this machinery).

**Files:**
- Create: `backend/src/services/locationEvidence/{acceptFlow,recheck,acceptance}.ts`
- Modify: `backend/src/services/dawarich/stays/review.ts` (TravTrack rows go through `acceptFlow`; Dawarich rows keep `acceptStayOnce` untouched), `stays/coverage.ts` (`coverageFor` skips visits whose `suggestion_ref` equals the candidate's evidence key — self-evidence)
- Modify (web): `frontend/src/components/dawarich/StayReviewCard.tsx` (source label "aus TravTrack" / "aus Dawarich"; "vor dem Quellwechsel erkannt" when `provider.rev` < the current rev; explanation copy by `explanation.code`), `frontend/src/components/inbox/workspace/{model.ts,InboxCard.tsx,InboxHistory.tsx}`, `frontend/src/lib/api/dawarichStays.ts`, `i18n/resources/{de,en}/trips.json`
- Tests: `locationEvidence/__tests__/{acceptFlow,recheck}.test.ts`, `routes/__tests__/dawarichStays.accept.test.ts` (extend), Vitest `StayReviewCard.test.tsx`

**Interfaces — `acceptFlow(userId, ref, input, apply)`, three committed steps:**
1. **Claim** (own transaction, committed): `accepted` → **replay**: answer the stored entry, no re-check (an accepted stay survives a later deletion, rule 6). `pending`, or `accepting` with `claimed_at` older than `CLAIM_STALE_MS` (2 min — recovery after a crash between steps) → set `accepting`, a fresh `claim_token`, `claimed_at = now`. `accepting` with a fresh claim → 409 `SUGGESTION_ACCEPT_IN_PROGRESS` (the client retries; a concurrent second click never writes twice). Anything else → 409 `SUGGESTION_ALREADY_RESOLVED` (stays: `DAWARICH_ALREADY_RESOLVED`, the code the web reads). TravTrack off → 403 `TRAVTRACK_DISABLED` before claiming.
2. **Re-check** (no transaction held; reads TravTrack through E2, capturing the generation) by **the kind's own detector rules**, run over the suggestion's window ± 30 min:
   - stay: `detectStays` (accuracy ≤ 100 m, speed ≤ 3 m/s, gap ≤ 30 min, ≥ 3 points, ≥ 20 min) yields a candidate within `2 × RADIUS_METERS` of the source position covering ≥ 80 % of the window;
   - market/venue: `detectMarketVisits` against the area stored in the evidence (`market.areaIds` from the catalogue store) yields a visit meeting `MARKET_RULES`' duration;
   - country: E6's rule on the run's days; journey: E7's `movementRuns` yields a run overlapping ≥ 80 %.
   Outcome `holds` or `invalidated`.
3. **Publish** (transaction under `takeTravTrackLock`): the row must still be `accepting` with this `claim_token`, and the generation must equal the one the re-check captured — otherwise go back to step 2 once, then 409 `EVIDENCE_INVALIDATED`.
   - `holds` → `apply(tx)` (stay: today's place/visit logic, the visit written with `suggestion_ref = evidence_key`; country/journey: E6/E7), row `accepted`, claim cleared.
   - `invalidated` → row `invalidated`, `resolved_at`, claim cleared, **committed**, `EvidenceInvalidated` logged (ids and counts only) — and only then the HTTP answer 409 `EVIDENCE_INVALIDATED`. A client that never sees the answer finds the row invalidated on its next read.
- **Never self-evidence** (`acceptance.ts`): `ownEntries(userId, evidenceKey)` = entries whose `suggestion_ref` or `accepted_entry_*` names the key. The re-check, `coverageFor` and E7's logbook test never count them as support or cover of that same key; a retry after a lost answer reaches the entry through the replay in step 1, never as "already covered". An entry made from a DIFFERENT finding still covers (two scans of one stop → one visit).
- Reject: TravTrack rows as today (rejection memory, venue fragments restored), allowed with TravTrack off.

- [ ] **Step 1: Failing tests** — "accepting twice answers the same visit and writes one"; "two concurrent accepts write one visit; the second gets SUGGESTION_ACCEPT_IN_PROGRESS, then the replay"; "a claim left by a crash is taken over after two minutes"; "a lost response then a retry returns the first visit, not covered"; "points deleted since the scan → 409 EVIDENCE_INVALIDATED, and the row is invalidated even when the response is lost" (row read in a fresh connection after the request); "a range deleted between re-check and publish invalidates instead of accepting"; "a stay whose points now have a 40-minute gap no longer holds"; "a venue whose points no longer last the market duration no longer holds"; "TravTrack off → 403 TRAVTRACK_DISABLED, the finding stays pending, reject still works"; "the visit made by accepting does not cover its own finding on the next scan, and covers a different overlapping one"; "a Dawarich finding accepts exactly as before — no re-check, no claim columns written". Web: source label, pre-switch line, `EVIDENCE_INVALIDATED` copy removes the card, `SUGGESTION_ACCEPT_IN_PROGRESS` retries quietly, `TRAVTRACK_DISABLED` copy keeps it.
- [ ] **Step 2–4:** `npx jest acceptFlow recheck dawarichStays review coverage --forceExit`, `npx vitest --run StayReviewCard InboxCard localeKeyParity` → FAIL, implement, → PASS.
- [ ] **Step 5:** Commit `feat(inbox): accepting a TravTrack suggestion re-checks its evidence and never counts itself`.

### Task E5: History deleted — open questions vanish, answers stay

**Files:**
- Create: `backend/src/services/locationEvidence/invalidate.ts`, `backend/src/services/travtrack/removalHandlers.ts` (registers every handler once; imported by `routes/travtrack.ts` and `jobs/cronJobs.ts`)
- Modify: `backend/src/services/travtrack/deleteRange.ts` (each `PointsRemovedCause` gains `removed: { spans: Span[]; days: string[]; digests: Set<string> }` computed in the transaction BEFORE the delete — `spans` are the removed points' instants merged with a 30-min join gap; a new variant `{ kind: "origin"; origin: string }` for "delete this import"; `bumpHistoryGeneration` in the same transaction), `services/travtrack/zones.ts` (same collection before deleting inside a new or grown zone; a zone that deletes nothing still runs the handlers with empty `removed`), `services/travtrack/ingest.ts` (marks the UTC days of stored points dirty, raising `version`)
- Tests: `locationEvidence/__tests__/invalidate.test.ts`, `travtrack/__tests__/removalHandlers.test.ts`

**Interfaces:**
- `HistoryDeleted` = `onPointsRemoved(tx, userId, cause)`; `invalidateOnHistoryDeleted` is registered here; E6 (country projection), L1, L3 add theirs; T7's snapshot handler beside them.
- A TravTrack finding or suggestion is **affected** when any of:
  - its window overlaps one of `removed.spans` (range, origin, zone);
  - one of its `evidence.pointDigests` is in `removed.digests` (a constituent point went, wherever its window lies);
  - zone cause: its source position, a journey's stored line (`evidence.line`, E7: a chord crossing the circle, `segmentCrossesZone`) or endpoint lies in the circle — even when the zone deleted no point;
  - no pin (country, trip): one of its days is in `removed.days`.
- Affected **open** rows (`pending`, `accepting`, `superseded`, `covered`, `rejected`, `invalidated`) → **deleted** (they hold positions and digests of the deleted history and none is an entry the user made); `EvidenceInvalidated { id, reason: "historyDeleted" | "zone" }` logged with ids and counts only. Affected **accepted** rows → evidence replaced by `{ source, provider, algorithmVersion, explanation, historyDeletedAt }`; stays' `source_lat/lon` set to the accepted `lat/lon` (the place's own pin, TravStats data); digests, lines and endpoints dropped.
- `removed.days` are marked dirty (projections re-derive them). Dawarich rows are never touched (their history is not ours to see).
- The generation bump makes every derivation that read before this removal discard its publication (E3, E4, E6, E7).

- [ ] **Step 1: Failing tests** — "a range delete removes every open TravTrack finding and suggestion inside it, in the same transaction"; "deleting points outside a finding's window that were among its constituent points still removes it" (origin delete); "a new zone that deletes nothing still removes a pending journey whose line crosses it"; "a country question on a day whose points went is removed"; "an accepted stay and its visit survive; the finding keeps no digest and no source position but the accepted pin"; "a rejected finding inside the range is deleted, one outside stays"; "Dawarich findings are untouched"; "a rolled-back delete changes nothing and does not raise the generation"; "the zone's removed days and digests are those of the points it deleted, computed before they went"; "ingest marks only stored points' days dirty"; "every removal path runs the handler" (range route, day delete, zone create, zone update with `deleteStoredPoints`, import delete — through the app, so a test-only registration cannot pass).
- [ ] **Step 2–4:** `npx jest invalidate removalHandlers deleteRange zones ingest travtrack.points travtrack.zones --forceExit` → FAIL, implement, → PASS.
- [ ] **Step 5:** Commit `feat(location): deleted history takes its open questions with it; accepted entries stay`.

### Task E6: TravTrack country days, and country questions

The projection writes `country_days` rows with source `travtrack`, read by the passport as "unconfirmed track countries" like Dawarich's (forgejo#299: observations never enter the evidence fold). The Dawarich sweep is not touched.

**Files:**
- Modify: `backend/src/services/countryDays/store.ts` (`replaceCountryDays(…, tx?: DbTransaction)` — runs inside a caller's transaction when given one; the Dawarich sweep calls it as before)
- Create: `backend/src/services/travtrack/countryProjection.ts`, `backend/src/services/locationEvidence/countrySuggestions.ts`, `backend/src/routes/locationSuggestions.ts` (`/api/v1/location-suggestions`, enveloped family like `dawarichStays.ts`), OpenAPI paths, `apiResponseShape.baseline.json` entry; cron row `travtrack_projections` in `jobs/cronJobs.ts` (every 15 min)
- Modify (web): inbox `model.ts` (`InboxSource` + `"location"`), `InboxCard.tsx` (country card: country, days, first–last day, point count; "Besucht" / "Nur am Boden durchgereist" / "Nicht dort gewesen"), `frontend/src/lib/api/locationSuggestions.ts`, `i18n/resources/{de,en}/dataQuality.json`
- Tests: `travtrack/__tests__/countryProjection.test.ts`, `locationEvidence/__tests__/countrySuggestions.test.ts`, `routes/__tests__/locationSuggestions.test.ts`, existing `countryDaySweep.test.ts` and `countryDays/store` tests green unchanged, Vitest `InboxCard.location.test.tsx`

**Interfaces:**
- `projectTravTrackCountryDays(userId)` — only while the instance is on (TravTrack off: nothing runs, dirty days wait). Per run up to 62 dirty days, oldest first, one **day per transaction**, each transaction under `takeTravTrackLock`: read the dirty row's `version`; read the day `[day 00:00Z, next day 00:00Z)` (half-open) through `readTravTrackDerivation`; `toTimedPosition` (in-flight and masked points dropped before the reducer, exactly as the Dawarich sweep drops airborne ones); `accumulateCountryDays` with `knownAirports`; `replaceCountryDays(userId, "travtrack", dayWindow, observations, partialDays, tx)` — a day read as `truncated` (over 250 000 points) is written with `partialWindow: true`; then **ack**: set the `done` bit only if `version` is unchanged (a point stored meanwhile re-marked the day and it runs again). No subdivision: TravTrack pages to the end. Failure kinds into `travtrack_derivation_state.last_error_kind`: `disabled`, `database`, `reducer`.
- A raise of `COUNTRY_DAY_REDUCER_VERSION` re-marks every day holding TravTrack points once.
- E5's handler (`projectionsOnHistoryDeleted`) deletes the `travtrack` rows on `removed.days` in the removal's transaction.
- `countrySuggestions(userId)` — after a projection run, provider `travtrack` + ok only: a country with ≥ 2 ground days (`airportPointCount < pointCount`) in `travtrack` rows, not among the passport's confirmed countries, with no `CountryOverride` → one `location_suggestions` row per contiguous run of days (`kind: "country"`, `evidence_key = HMAC(["country", code, firstDay])`, `evidence = { countryCode, days, pointCount }`, explanation `{ code: "country.groundDays", params: { days, points } }`); a pending row for the same run grows; a rejected run is never asked again. **Bounded:** at most 3 new country questions per run. Publication under the lock with the generation check (E5).
- `POST /location-suggestions/:id/accept { verdict: "visited" | "ground" }` through `acceptFlow` (E4): re-check = the run's `travtrack` rows still name the country on ≥ 2 ground days; apply = `CountryOverride { verdict, day: firstDay, note: "" }`, `accepted_entry_kind = "countryOverride"`. An override the user set meanwhile → the suggestion resolves `accepted` naming it; nothing overwritten. `POST /:id/reject`. `GET /location-suggestions?status=pending` → `{ success, data: EvidenceSuggested[] }`.

- [ ] **Step 1: Failing tests** — "a dirty day becomes travtrack country days and is acked"; "a point stored during the projection re-marks the day and it runs again" (version changed between read and ack); "a failed day leaves the dirty row and the old rows unchanged" (transaction); "the window is half-open: a point at 00:00:00Z belongs to the next day"; "airside-only points make no ground day; in-flight points none at all"; "a day over the cap is written partial"; "deleting a range removes that day's travtrack rows in the same transaction; the next run re-derives what is left"; "TravTrack off: nothing runs, the dirty days stay"; "a dawarich sweep never deletes a travtrack row and the reverse"; "the Dawarich sweep's suite is unchanged" (no file of it edited but the shared `store.ts` signature). Suggestions: "two ground days in a country the passport lacks → one question"; "held already / overridden → none"; "a third day grows it"; "a rejected run is not asked again"; "no more than three new per run"; "provider dawarich → none"; "accept writes the override once, twice answers the same"; "accept after the days were deleted → 409 EVIDENCE_INVALIDATED, committed". Web: the three answers and their codes' copy.
- [ ] **Step 2–4:** `npx jest countryProjection countrySuggestions locationSuggestions countryDaySweep store openapi apiResponseShape passport --forceExit`, `npx vitest --run InboxCard localeKeyParity` → FAIL, implement, → PASS.
- [ ] **Step 5:** Commit `feat(countries): TravTrack country days, and a question for a country the passport lacks`.

### Task E7: Missing journeys — movement the logbook does not hold

**Files:**
- Create: `backend/src/services/locationEvidence/journeys/{segment.ts,entryWindows.ts,suggest.ts}`; journey accept in `routes/locationSuggestions.ts`
- Modify (web): inbox journey card, and the forms it opens with a prefill — `components/rail/RailFormModal.tsx`, `components/bus/BusFormModal.tsx`, the roadtrip create in `components/Roadtrips` — via `components/inbox/workspace/journeyPrefill.ts`; `i18n/resources/{de,en}/dataQuality.json`
- Tests: `journeys/__tests__/{segment,entryWindows,suggest}.test.ts`, `routes/__tests__/locationSuggestions.journey.test.ts`, Vitest `journeyPrefill.test.ts`

**Interfaces:**
- `movementRuns(points: DerivationPoint[]): Run[]` — pure; between stays (E3's detector), a run with ≥ 10 points, ≥ 20 km along its privacy-cut line, median ground speed 15–300 km/h, no `inFlight` point; `modeHint: "rail" | "road" | "unknown"` from the speed profile only — a hint, never a decision.
- **`entryWindows.ts` — explicit per-domain adapters.** `AVAILABLE_DOMAINS` names domains; it reads nothing. So: `ENTRY_WINDOW_ADAPTERS: Record<DomainKey, { read(userId, window): Promise<EntryWindow[]> } | { none: string /* why the domain has no time window */ }>` with one adapter per domain that has one — flight (`recorderWindow`), rail, bus, ferry, cruise, rental, roadtrip, lodging (check-in…check-out), poi (place visits with an instant) — each a Prisma read of that table's own columns on its own clock. A test fails when a key of `DOMAIN_KEYS` is missing (the `DOMAIN_SHARING` pattern), so a new domain must be classified. `logbookWindows(userId, window)` iterates `AVAILABLE_DOMAINS` through the adapters. A run is covered when ≥ 50 % of its duration lies in one window; `ownEntries` (E4) never cover their own suggestion.
- `suggestJourneys(userId)` — after the TravTrack stay scan, same window (7 days), provider `travtrack` + ok + instance on; skipped when none of `rail`, `bus`, `roadtrip` is enabled. **Bounded:** one question per local day (the day's uncovered runs listed inside it, each linkable separately), at most 7 new per run. Row: `kind: "journey"`, `evidence_key = HMAC(["journey", day, firstKey])`, `evidence = { runs: [{ fromMs, untilMs, km, start, end, line /* ≤ 200 vertices, privacyCut */, modeHint, pointDigests }] }`, explanation `{ code: "journey.unlogged", params: { runs, km } }`. Publication under the lock with the generation check.
- Accept per run, through `acceptFlow` (E4): `POST /location-suggestions/:id/accept { runIndex, entryKind: "rail" | "bus" | "roadtrip", entryId }` — the entry is created by the user through the TravStats form; the server checks it exists, is the user's, overlaps the run ≥ 50 % (else 400 `VALIDATION_FAILED`); the suggestion is `accepted` when every run is linked or the user closes the rest. Same entry twice → the same answer; another entry on a linked run → 409 `SUGGESTION_ALREADY_RESOLVED`. A form saved whose accept failed leaves the entry standing and the run open; the card offers "mit gespeichertem Eintrag verknüpfen" next time (the pending `entryId` in the client's draft store).
- **Privacy:** km, endpoints and line are taken from the run after `privacyCut`; a run ending in a zone ends at its last point outside and the card says "Ende nicht aufgezeichnet". Lines are inbox-only and dropped by E5 on deletion.

- [ ] **Step 1: Failing tests** — "a 90-minute run between two stays is one run with a speed-profile hint"; "an in-flight point makes no journey"; "a run covered by a rail ride, bus ride or roadtrip day is not suggested"; "every DOMAIN_KEYS entry has an adapter or a reason" (fails for a fake new key); "each adapter reads its own table's window" (one case per adapter); "the rail ride created from a run does not cover that run next time"; "three runs on one day are one question"; "no more than seven new per run"; "accept links once; twice the same; another entry 409"; "an entry outside the run's window is refused"; "a run crossing a zone measures only its visible part and never ends inside it"; "no questions when rail, bus and roadtrip are all disabled"; "provider dawarich → none". Web: prefill opens the rail form with times and both ends; a saved form whose accept failed offers the link.
- [ ] **Step 2–4:** `npx jest journeys locationSuggestions --forceExit`, `npx vitest --run journeyPrefill InboxCard localeKeyParity` → FAIL, implement, → PASS.
- [ ] **Step 5:** Commit `feat(inbox): a journey TravTrack saw and the logbook lacks becomes a question`.

### Task E8: One ingest pipeline, and GPX files into TravTrack

GPX only. TCX and FIT (both parsers exist in `services/tour/tracks/parseTrackFile.ts`) are listed for later; they need their own fixtures and nothing here depends on them.

**Files:**
- Modify: `backend/src/services/travtrack/ingest.ts` → `ingestPoints({ userId, origin, deviceId, uploadId: string | null, points, gaps?, outer?: DbTransaction, fence?: (tx) => Promise<void> })` — the Companion route passes `origin = companion:<deviceId>` and its `uploadId` (answers unchanged); `uploadId: null` skips the receipt (dedup by `(origin, originRef)` and the position key still hold); `outer` runs inside a caller's transaction (L6); `fence` runs first under the lock and may throw to abort (imports, below). Zone → deleted range → duplicate, per point, for every source.
- Create: `backend/src/services/travtrack/imports/{fileImport,mapGpx}.ts`, `backend/src/routes/travtrack/imports.ts`, OpenAPI paths, baseline entry; `JobKind` `"travtrack.fileImport"` in `services/jobs/jobRegistry.ts`
- Schema (E1's migration): `travtrack_imports` — `id`, `user_id` FK cascade, `kind` (CHECK `gpx|dawarich`), `file_name` (≤ 200), `status` (CHECK `running|succeeded|failed|interrupted|cancelled`), `report jsonb`, `from_at`, `to_at`, `created_at`, `finished_at`
- Modify (web): `TravTrackSection.tsx` ("GPX importieren", the imports with their report, "Import löschen"), `i18n/resources/{de,en}/track.json`
- Tests: `travtrack/__tests__/{ingest.origin,fileImport}.test.ts`, `routes/__tests__/travtrack.imports.test.ts`, `travtrack.points.test.ts` (unchanged), Vitest `TravTrackSection.import.test.tsx`

**Interfaces:**
- `POST /travtrack/imports` (multipart `file`, write scope, `rejectDemo`, `on` tier, ≤ 25 MB, multipart Content-Type set by hand on the web) → 202 `{ jobId, importId }`. The job parses with `parseGpx`, maps each point with a time — `origin = gpx:<importId>`, `originRef = <segment>:<index>`, `deviceId = file:<importId>`, `purpose: "everyday"` — and ingests batches of 5000 with `fence` = "this import is still `running`" (so a delete of the import stops it: below). No times → `failed`, `TRAVTRACK_IMPORT_NO_TIMES`; unreadable → `TRAVTRACK_IMPORT_UNREADABLE`; one running already → 409 `TRAVTRACK_IMPORT_RUNNING`. Report `{ read, stored, duplicate, dropped: { privacy_zone, deleted_range, invalid, null_island }, withoutTime }`.
- `GET /travtrack/imports` (`held`); `DELETE /travtrack/imports/:id` (`held`, write scope, `rejectDemo`) → under the lock: status `cancelled` (a running import's next batch fails its fence and stores nothing), delete the points with that origin, `onPointsRemoved({ kind: "origin", origin, removed })`. No tombstone: other sources' points in that span stay; a GPX fix that duplicated a Companion fix was never stored under this origin, so the Companion's copy stays.
- Imports mark their days dirty; they never trigger a stay or journey scan of their span and never prompt (review focus 19).
- Export JSON (T6) carries each point's `origin`; the summary lists `file:<id>` devices with the file name.

- [ ] **Step 1: Failing tests** — "the Companion route answers exactly as before" (existing suite); "an upload without uploadId stays idempotent by origin ref and position"; "inside an outer transaction nothing is visible until it commits"; "a GPX point inside a privacy zone is dropped and counted"; "a GPX file into a deleted range stores nothing there"; "a GPX fix equal to a Companion fix is a duplicate; deleting the import leaves the Companion fix"; "deleting a running import cancels it: no batch after the delete stores a point"; "deleting an import removes only its points and leaves no tombstone"; "a file without times fails with TRAVTRACK_IMPORT_NO_TIMES"; "a second import while one runs is 409"; "TravTrack off: import 403, list and delete reachable for an account holding data"; "an import over last week creates no finding". Web: multipart upload and report; delete asks with the point count.
- [ ] **Step 2–4:** `npx jest ingest fileImport travtrack.imports travtrack.points openapi apiResponseShape --forceExit`, `npx vitest --run TravTrackSection localeKeyParity` → FAIL, implement, → PASS.
- [ ] **Step 5:** Commit `feat(travtrack): import GPX files through the same pipeline`.

### Task E9: OwnTracks and Overland with per-device tokens

**Step 0 (before any code): record real requests.** OwnTracks (Android and iOS, HTTP mode) and Overland (iOS) against a request-capturing endpoint on the dev stack: one location message of each, one empty OwnTracks POST and one non-location message (`transition`, `lwt`), one Overland batch of ≥ 3 points. Saved as fixtures under `backend/src/services/travtrack/sources/__fixtures__/`, every real position replaced by a fixed test coordinate. The mappings below follow the apps' documented formats; where a fixture disagrees, the fixture wins and this task is amended.

**Files:**
- Create: `backend/src/services/travtrack/sources/{owntracks,overland,ingestTokens}.ts`, `backend/src/middleware/ingestTokenAuth.ts`, `backend/src/routes/travtrack/{ingestSources,ingestTokens}.ts`, OpenAPI paths, baseline entries
- Schema (E1's migration): `travtrack_ingest_tokens` — `id`, `user_id` FK cascade, `kind` (CHECK `owntracks|overland`), `label` (≤ 60), `lookup_hash` UNIQUE, `hash`, `created_at`, `last_used_at`, `revoked_at`
- Modify: `/travtrack/capabilities` (`sources: Array<"companion" | "gpx" | "owntracks" | "overland">`), the logger's redaction list (`authorization` header)
- Modify (web): `TravTrackSection.tsx` ("Weitere Quellen": create → shown once with URL and the app's field names, list, revoke), `i18n/resources/{de,en}/track.json`
- Tests: `sources/__tests__/{owntracks,overland,ingestTokens}.test.ts`, `routes/__tests__/travtrack.ingestSources.test.ts`

**Interfaces:**
- **Tokens** (`ingestTokens.ts`, the `utils/apiTokens.ts` scheme): `tt_ingest_` + 32 random bytes (`randomBytes`), `lookup_hash` = SHA-256 (O(1) lookup), `hash` = bcrypt, verified by `bcrypt.compare`; the row's `kind` must equal the path's kind — an OwnTracks token on the Overland path, a revoked or unknown token → 401 `INGEST_TOKEN_INVALID`. A token posts points for its owner and does nothing else; it is not an `ApiToken`.
- Management: `POST /travtrack/ingest-tokens { kind, label }` (`on` tier, write scope, `rejectDemo`) → `{ id, token, url }` once; `GET` (`held`) → list without secrets; `DELETE /:id` (`held`, write scope, `rejectDemo`) → revoked.
- **OwnTracks** `POST /travtrack/ingest/owntracks` — **HTTP Basic only** (username free, password = token). Body: one message, an array, or empty. `_type: "location"` → `{ t: tst (s) → ISO, lat, lon, accuracy: acc, altitude: alt, speed: vel (km/h → m/s), course: cog }`, `originRef = "<tst>:<lat>:<lon>"`; every other `_type` and an empty body (0 bytes or `{}`) store nothing. Answer always **200 `[]`** once authenticated (OwnTracks resends on an error status); invalid points are counted, never refused, so one bad message cannot wedge the phone's queue.
- **Overland** `POST /travtrack/ingest/overland` — **`Authorization: Bearer <token>` header only**; no query-string token, ever (if Step 0 shows a build that cannot send the header, Overland is left out and the owner is told). `{ locations: Feature<Point>[] }`: `coordinates [lon, lat]`, `properties.timestamp` (offsets like `-0700` normalised to `-07:00` before parsing; no offset → invalid), `horizontal_accuracy` and `speed` (negative → null), `altitude`, `course`, `motion[0]` → `motion`; `originRef = <normalised timestamp>:<lon>:<lat>`. Answer **200 `{ "result": "ok" }` only after the transaction committed** (Overland deletes its batch on that answer alone); an empty `locations` → the same answer; any failure → non-2xx so the phone keeps it.
- Both: `origin = deviceId = <kind>:<tokenId>`, `purpose: "everyday"`, `uploadId: null` (E8), `on` tier (off → 403 `TRAVTRACK_DISABLED`, the app keeps its queue), provider not consulted (as T3), limiter keyed by token id, body ≤ `LOCATION_MAX_BODY_BYTES`. **Privacy:** these apps cannot filter zones; ingest drops the points there, and the settings copy says positions inside a zone reach the server and are discarded there, unlike the Companion.

- [ ] **Step 1: Failing tests** — fixtures: "the recorded OwnTracks location becomes one point with speed in m/s"; "an empty OwnTracks POST and a transition store nothing and answer []"; "the recorded Overland batch stores every point and answers result ok"; "a -0700 offset is read as -07:00"; "negative accuracy or speed is stored as unknown". Auth: "OwnTracks takes Basic with the token as password and refuses Bearer"; "Overland takes the Bearer header and refuses a query token and Basic"; "an OwnTracks token on the Overland path is 401 INGEST_TOKEN_INVALID"; "a revoked token is 401"; "a token cannot read /travtrack/points or call any other route"; "creating and revoking need write scope and refuse the demo account". Pipeline: "an OwnTracks point inside a zone is dropped and the answer is still []"; "a resent Overland batch stores nothing twice"; "a failure inside the transaction answers 5xx, never result ok"; "TravTrack off: 403, nothing stored"; "no log line carries a token" (captured logs).
- [ ] **Step 2–4:** `npx jest owntracks overland ingestTokens travtrack.ingestSources travtrack.gate openapi apiResponseShape --forceExit`, `npx vitest --run TravTrackSection localeKeyParity` → FAIL, implement, → PASS.
- [ ] **Step 5:** Real apps against the Beta server with TravTrack on: a short walk arrives on `/track` as its own device line; a zone at the start leaves no point inside it. Commit `feat(travtrack): take positions from OwnTracks and Overland with per-device tokens`.

### Task E10: Timeline labels from TravStats

Depends on E7's entry-window adapters (and on E3/E7 for suggestion labels; without them those labels are absent).

**Files:**
- Create: `backend/src/services/travtrack/dayContext.ts` (moved out of `dayView.ts`, which keeps the geometry; both under 400 lines)
- Modify: `backend/src/routes/travtrack/day.ts`, OpenAPI path, `frontend/src/pages/Track/{TrackTimeline,TrackDayMap}.tsx`, `i18n/resources/{de,en}/track.json`
- Tests: `travtrack/__tests__/dayContext.test.ts`, `routes/__tests__/travtrack.day.test.ts` (extend), Vitest `TrackTimeline.test.tsx`

**Interfaces:**
- `context[].kind` widens from `flight | trip | home` to `flight | trip | home | <every domain with an entry-window adapter> | suggestion`, each `{ kind, id, label, fromMs, untilMs, href }`, read through `logbookWindows` (E7) — records from TravStats tables, not from points — plus open TravTrack stay/journey suggestions of the day (`href` to the inbox card).
- Moving stretches of the day's privacy-safe segments covered by no context entry (≥ 2 km) are `unlabelled: true` — "Unterwegs, ohne Eintrag" — never with a guessed mode.
- **Privacy:** labels attach to TravStats records; a label's map anchor is the record's own pin or the first privacy-safe vertex of its stretch, never a point inside a circle; "home" stays computed from privacy-safe points only (T6). The `on` tier as before.

- [ ] **Step 1: Failing tests** — "a day with a rail ride, a hotel night and a café visit shows all three with links"; "an open stay suggestion appears with its inbox link and goes once answered"; "an uncovered moving stretch is unlabelled, without a mode"; "a place visit whose pin lies in a zone is listed without a map anchor"; "a fake domain with an adapter appears without editing dayContext". Web: timeline labels, links, "Unterwegs, ohne Eintrag".
- [ ] **Step 2–4:** `npx jest dayContext travtrack.day --forceExit`, `npx vitest --run TrackTimeline localeKeyParity` → FAIL, implement, → PASS; browser look at a seeded day.
- [ ] **Step 5:** Commit `feat(travtrack): a day reads like the logbook — labelled from TravStats`.

### Review Focus additions (append to the list at the top)

Phase 3:

17. **Dawarich users see nothing change** — stays, venues and country days come out byte-identical (golden fixture from `main`, E3; the sweep untouched, E6); no zone, mask or deleted-range filter on Dawarich reads; no re-check on their accept; no new inbox kind. Zones on Dawarich-derived suggestions, a Dawarich re-check and Dawarich country/journey questions are open owner decisions.
18. **The neutral key** — TravTrack evidence is identified by the position key (second + coordinates) and stored only as server-keyed HMAC digests that never leave the server; cross-provider repeats are caught by the interval/radius match; no stop is suggested twice across the change, a provider switch or an import. Pinned in E1, E3.
19. **Bounded prompting** — imports and projections never trigger detection of their span; per run at most 20 stays, 3 countries, 7 journey days (one question per day), and in phase 4 three trips. Pinned in E3, E6, E7, E8, L4.
20. **TravTrack off** — no TravTrack derivation runs and accepting a TravTrack suggestion is 403 `TRAVTRACK_DISABLED`; removal and its invalidation keep working; Dawarich derivations ignore the switch. Pinned in E3, E4, E6.
21. **Accept is a committed protocol** — claim, re-check by the kind's own detector rules, publish under the lock with the generation check; an invalidation is committed before the 409; concurrent clicks write once; a crashed claim recovers. Pinned in E4.
22. **Self-evidence** — an entry made by accepting is reached by replay on a retry, never counted as cover or support of the same evidence key, and still covers a different finding. Pinned in E4, E7.
23. **A scan cannot publish from deleted history** — every removal raises the history generation in its transaction; every TravTrack publication and acceptance compares it under the same lock. Affected evidence is found by window, by constituent digest, by line crossing a new zone, and by day for pinless questions. Pinned in E3, E4, E5.
24. **Projection writes are atomic** — read, replace and ack of a dirty day in one transaction, acked only for the version read. Pinned in E6.
25. **Third-party clients** — OwnTracks Basic only, Overland Bearer header only, no token in a URL or a log; tokens are kind-bound; Overland gets `result: ok` only after commit; OwnTracks always gets `[]`. Pinned in E9.

### Phase 3 exit

- [ ] Server gates (Build Checks) green on `dev/travtrack`; `npm run check:drift` green with `<ts>_location_evidence`.
- [ ] Codex review of the diff since phase 2; findings fixed.
- [ ] Browser look: a TravTrack stay card, a country card, a journey card through the rail form, `/track` labels, the GPX import and token screens.
- [ ] Ask the owner, as a single question, whether phase 3 goes to `main` / an RC (still behind `travTrack`); ask the three open decisions separately.

---

## Phase 4 — later

Every task here is TravTrack-only, behind the `travTrack` beta key and the **`on` tier** for computing and for reading (TravTrack off: 403 `TRAVTRACK_DISABLED`, nothing runs) — except L5, which sits behind TravPlan's gate and reads through `entryTrack`, so Dawarich users get it too, and L6, which needs an own Dawarich connection. Each task has its own migration (throw-away clone DB, `migrate deploy` on the shared dev DB, `check:drift` green). The phase-3 privacy rules hold for every output: zones and zone tombstones, deleted ranges, `privacyCut` on final geometry, own account only (never in a share, `.travstats` file, public link, comparison or federation payload), and every projection is removed with the history it came from (a handler in `removalHandlers.ts`, same transaction, then dirty-day re-derivation acked per version, as E6).

**Dependencies.** L1 extends E6's dirty-day protocol (its own `done` bit); L3 needs L1's bit scheme and E6's country days; L4 needs the envelope and `acceptFlow` (E1, E4), the suggestions route (E6) and `movementRuns` (E7); L5 needs only T5's `entryTrack`; L6 needs E8's `ingestPoints` (`outer`, `fence`) and E5's generation. **Order:** L6 first if the owner wants the Dawarich history in TravTrack before the views are judged; then L1 → L3, L4, L2, L5.

### Task L1: „Erkundet" — the explored map

**Files:**
- Create: migration `<ts>_travtrack_explored`, `backend/src/services/travtrack/explored/{cells,project,privacy}.ts`, `backend/src/routes/travtrack/explored.ts`, OpenAPI path, baseline entry; `frontend/src/pages/Track/TrackExploredMap.tsx` (a tab on `/track`; a dashboard map mode is a separate owner decision — `TAB_MODE_REGISTRY` keys modes by tab and TravTrack has none)
- Tests: `explored/__tests__/{cells,project,privacy}.test.ts`, `routes/__tests__/travtrack.explored.test.ts`, Vitest `TrackExploredMap.test.tsx`

**Schema:** `travtrack_explored_cells` — `user_id` FK cascade, `day Date`, `x Int`, `y Int` (Web-Mercator tile at **zoom 14**, the one resolution stored and served); `PRIMARY KEY (user_id, day, x, y)`. Rows per day keep re-derivation exact.

**Interfaces:**
- `projectExploredCells(userId)` — E6's protocol with `done` bit 2: one day per transaction under the lock, cells from `readTravTrackDerivation` (masked and in-flight points excluded), ack only for the version read.
- Removal handler: deletes the cells of `removed.days`; the next run rebuilds them from what is left.
- **One output format, one privacy model:** `GET /travtrack/explored?bbox=<w,s,e,n>` → `{ cells: [x, y][] }` — always zoom-14 cells, whatever the map's zoom (the client draws them larger or smaller; there is no coarser or finer answer whose difference could outline a zone), ≤ 50 000 per answer (else 400 "zoom in"), no time. **Zones are shown as explored ground, never as a hole and never as a different shape:** a cell that intersects a privacy circle is emitted when any cell edge-adjacent to it is explored — a fixed display rule, said in the legend ("Privatzonen werden als erkundet gezeigt"). A zone (≤ 5 km radius) is therefore indistinguishable from an area the user moved through.
- Map: a MapLibre fill of the cells over a fog layer; no dots at any zoom.

- [ ] **Step 1: Failing tests** — "a day's points become its cells once, acked"; "deleting a day's range removes its cells and keeps cells other days explored"; "a 5 km zone surrounded by explored cells leaves no hole: its cells are emitted"; "an isolated zone with no explored neighbour emits nothing"; "the answer is the same cell set for any requested zoom"; "airborne and masked points explore nothing"; "the answer carries no time"; "TravTrack off → 403"; "another account's cells are never read". Web: cells drawn, never points; the legend line.
- [ ] **Step 2–4:** `npx jest explored travtrack.explored openapi apiResponseShape --forceExit`, `npx vitest --run TrackExploredMap localeKeyParity` → FAIL, implement, → PASS. **Step 5:** Browser look; commit `feat(travtrack): the explored map`.

### Task L2: „Zuletzt gesehen"

**Files:**
- Create: `backend/src/services/travtrack/lastSeen.ts`, route `GET /travtrack/last-seen` in `routes/travtrack/points.ts` (`on` tier), OpenAPI path; `frontend/src/components/Dashboard/LastSeenCard.tsx` (beside `MapNextUpCard.tsx` in `DashboardLayout.tsx`, shown by `useTravTrackVisible`) + `/track` header line
- Tests: `travtrack/__tests__/lastSeen.test.ts`, `routes/__tests__/travtrack.lastSeen.test.ts`, a separation test, Vitest `LastSeenCard.test.tsx`

**Interfaces:**
- `lastSeen(userId): Promise<{ atMs; lat; lon; accuracyM; deviceId; origin } | null>` — the newest stored point (`(user_id, t, seq)` index, one row), masked points skipped. Points inside a zone are never stored, so it is the last position before a zone (spec §3: "Nothing derives from a zone — „Zuletzt gesehen" shows the last position before it"). Answers `no-store` (the `/api` default). TravTrack-only: a Dawarich equivalent would read Dawarich unfiltered and is not built (open decision (a) applies).
- No share, public-link, comparison or federation module imports `lastSeen.ts` (source scan, like `encryptedShare/__tests__/separation.test.ts`).

- [ ] **Step 1: Failing tests** — "the newest point with its device"; "a masked teleport is not the last seen"; "no points → null"; "TravTrack off → 403"; "no sharing, public-link or federation module imports lastSeen"; "the answer is no-store". Web: age ("vor 12 Min."), device label, hidden when TravTrack is not visible.
- [ ] **Step 2–4:** FAIL → implement → PASS (`npx jest lastSeen travtrack.lastSeen apiNoStore --forceExit`, `npx vitest --run LastSeenCard localeKeyParity`). **Step 5:** Commit `feat(travtrack): where you were last seen`.

### Task L3: Monthly values — km, countries, cities

Needs L1's `done`-bit scheme (bit 4) and E6's travtrack country days.

**Files:**
- Create: migration `<ts>_travtrack_months`, `backend/src/services/travtrack/months/{project,cities}.ts`, `backend/src/routes/travtrack/months.ts`, OpenAPI path, baseline entry; `frontend/src/pages/Track/TrackMonths.tsx`; a per-account switch `travtrack_city_lookup Boolean @default(false)` on `user_settings` with its line in `TravTrackSection.tsx`
- Tests: `months/__tests__/{project,cities}.test.ts`, `routes/__tests__/travtrack.months.test.ts`, Vitest `TrackMonths.test.tsx`

**Schema:** `travtrack_month_values` — `user_id`, `month Date`, `km_ground Float`, `countries String[]`, `cities jsonb | null`, `days_with_data Int`, `days_paused Int`, `algorithm Int`, `computed_at`; `PRIMARY KEY (user_id, month)`. `geo_city_cache` — `cell String @id` (lat/lon rounded to 0.01°), `name`, `country_code`, `fetched_at`; no user id, no time, no track (precedent `market_catalog_tiles`).

**Interfaces:**
- `projectMonths(userId)` — a month is recomputed (in one transaction, acked per day version) when any of its days is dirty: `km_ground` from the privacy-safe segments (`readSafeTravTrack`, so no figure counts a hidden part) minus in-flight points and runs above 500 km/h (spec §10 point 5); `countries` from `country_days` source `travtrack`; `cities` only when the account switched the lookup on.
- `cities.ts` — reuses the reverse geocoder the codebase already has (`services/geo/nominatim.ts` `reverseGeocode`, the one place addresses come from); dwell clusters ≥ 30 min outside privacy circles, each rounded cell looked up once through `geo_city_cache`. Because that geocoder may be a public Nominatim, the lookup is **off by default** and the switch's copy says rounded positions are sent to it; off → `cities: null` and "Städte nicht ermittelt" (abstention, never an empty list). No new geocoder infrastructure.
- Removal handler: deletes the months of `removed.days`; re-derived next run.
- `GET /travtrack/months?year=YYYY` (`on`) → `{ months: [{ month, kmGround, countries, cities, daysWithData, daysPaused }] }`; a month without data is absent, not zero.

- [ ] **Step 1: Failing tests** — "km counts only the visible line: a stretch through a zone adds nothing for its hidden chord"; "a flight's points add no ground km"; "a month without points is absent"; "cities: off by default → null, no geocoder call"; "on: one lookup per rounded cell, never for a cluster inside a zone"; "the city cache holds no user id"; "deleting a day recomputes its month in the same transaction"; "TravTrack off → 403". Web: the month table, "nicht ermittelt", the switch copy.
- [ ] **Step 2–4:** FAIL → implement → PASS (`npx jest months travtrack.months openapi --forceExit`, `npx vitest --run TrackMonths TravTrackSection localeKeyParity`). **Step 5:** Commit `feat(travtrack): monthly kilometres, countries and cities`.

### Task L4: Trip inference

Needs E1/E4 (envelope, `acceptFlow`), E6 (suggestions route) and E7 (`movementRuns`). Phase 3 asks about single unlogged legs; this task groups what TravTrack saw into trips: away-from-home periods without a trip.

**Files:**
- Create: migration `<ts>_location_suggestion_trip` (`location_suggestions.kind` CHECK + `trip`), `backend/src/services/locationEvidence/trips/{awayPeriods,suggest}.ts`; trip accept in `routes/locationSuggestions.ts`
- Modify (web): inbox trip card (new / extend), `i18n/resources/{de,en}/dataQuality.json`
- Tests: `trips/__tests__/{awayPeriods,suggest}.test.ts`, `routes/__tests__/locationSuggestions.trip.test.ts`, Vitest `InboxCard.trip.test.tsx`

**Interfaces:**
- `awayPeriods(userId, window)` — per local day (the home period's zone) from privacy-safe points: `away` when mostly > 50 km from that day's confirmed residence (`loadHomePeriods`), `home` when mostly within, `unknown` without points (absence of data is not presence; an `unknown` day never joins two runs). Runs of ≥ 2 away days or one away night. No confirmed residence → nothing inferred, and the settings line says why.
- `suggestTrips(userId)` — nightly over the last 60 days only (never the whole history, never over an import's span by itself), provider `travtrack` + ok + instance on. **Bounded:** at most 3 new trip questions per run; runs beyond that are aggregated into one "Weitere N Zeiträume unterwegs" entry that expands on request rather than as separate cards. Row: `kind: "trip"`, `evidence_key = HMAC(["trip", fromDay])` (grown while pending), `evidence = { fromDay, toDay, countries, km }`, explanation `{ code: "trip.away" | "trip.extend", params: { days, km, tripId? } }`. Publication under the lock with the generation check.
- Accept through `acceptFlow`: re-check = the run's away days still hold; apply (TravStats, on the user's decision) = `{ action: "create", name }` → the existing trip create service with the run's days, or `{ action: "extend", tripId }` → that trip's days widened, nothing else; idempotent through `accepted_entry_*`. Pinless: E5 removes an open one whose days are in `removed.days`.
- **Privacy:** the card shows days, countries, km — no map.

- [ ] **Step 1: Failing tests** — "three days > 50 km from the confirmed home are one away run"; "a day without points is unknown and splits nothing into home"; "no confirmed residence → no questions"; "a run covered by a trip → none; touching its edge → extend"; "at most three new per run, the rest aggregated"; "accept create makes one trip, twice the same"; "accept extend widens only the dates"; "a rejected run is not asked again"; "deleting the run's points removes the open question"; "TravTrack off → nothing runs, accept 403". Web: both cards, the aggregate entry, the name field.
- [ ] **Step 2–4:** FAIL → implement → PASS (`npx jest awayPeriods trips locationSuggestions --forceExit`, `npx vitest --run InboxCard localeKeyParity`). **Step 5:** Commit `feat(inbox): a trip TravTrack saw becomes a question`.

### Task L5: TravPlan — plan versus actual

**Files:**
- Create: `backend/src/services/travplan/actual/{planSnapshot,actualRoute,compare}.ts`, route `GET /trips/:tripId/plan/actual` in `routes/travplan.ts` (behind `assertTravPlanOffered` and the plan's own access check), OpenAPI path; `frontend/src/pages/TravPlan/sections/PlanActualPanel.tsx`, `i18n/resources/{de,en}/travplan.json`
- Tests: `services/travplan/__tests__/{planSnapshot,compare}.test.ts`, `actualRoute.integration.test.ts`, `planActual.route.integration.test.ts`, Vitest `PlanActualPanel.test.tsx`

**Interfaces:**
- `getPlanSnapshot(userId, tripId)` → `{ revision; stations; stages; items; startDay; endDay; timezone } | null` — a read of `travel_plans.state` (active variant), deep-frozen; no write, no mutation row, no revision bump.
- `getActualRoute(userId, tripId)` → `{ segments: [lon, lat][][]; days: Array<{ day; state: "recorded" | "noData" }>; stays: Array<{ day; lat; lon; label }>; coverage; origin } | null` — `entryTrack(trip)` (T5: own recording, TravTrack or Dawarich by its rules; TravTrack off → TravTrack is simply not a source, as T5), simplified and `privacyCut` on the final geometry; stays from accepted place visits and lodging stays in the trip (TravStats records).
- `comparePlanActual(plan, actual)` — pure: per station `visited` (an actual position or stay within 15 km during its planned days ± 1), `shifted` (visited on other days; delta), `skipped` (recorded days around it, never within 15 km), `unknown` (no data on its days — never `skipped`); a station whose place lies in a TravTrack privacy circle is `unknown` (the missing points there are the zone, not a skip); per stage `{ plannedKm, actualKm | null }` (only between two visited stations); `unplanned` stays > 15 km from every station.
- `GET /trips/:tripId/plan/actual` → `{ plan: { revision }, actual: { origin, coverage } | null, stations, stages, unplanned }`; no track → `actual: null`, every station `unknown`. **The plan is never changed:** nothing here writes; the panel has no "apply".

- [ ] **Step 1: Failing tests** — "a station passed on its planned day is visited"; "a day late is shifted by one"; "recorded days around a station never near it → skipped"; "no data on its days → unknown"; "a station inside a zone → unknown"; "stage km only between two visited stations"; "a far accepted stay is unplanned"; "the request leaves the plan's revision, state hash, mutations and proposals unchanged"; "TravPlan off → 403 PLAN_DISABLED"; "another user's trip → 404". Web: the four states.
- [ ] **Step 2–4:** FAIL → implement → PASS (`npx jest planSnapshot compare actualRoute planActual --forceExit`, `npx vitest --run PlanActualPanel travplanTypesMirror localeKeyParity`). **Step 5:** Browser look on a seeded route plan; commit `feat(travplan): compare the plan with where you actually went`.

### Task L6: Copy the Dawarich history into TravTrack

An explicit copy the user starts. Dawarich is only read (rule 5), the provider does not change (rule 2), and the copy says what it did and did not get.

**Files:**
- Create: migration `<ts>_travtrack_dawarich_import`, `backend/src/services/travtrack/imports/dawarichImport.ts`, routes in `routes/travtrack/imports.ts` (`POST /travtrack/imports/dawarich`, `GET …/dawarich`, `POST …/resume`, `POST …/stop`), OpenAPI paths; `JobKind` `"travtrack.dawarichImport"`; web block "Dawarich-Verlauf übernehmen" in `TravTrackSection.tsx`, `i18n/resources/{de,en}/track.json`
- Tests: `imports/__tests__/dawarichImport.test.ts`, `routes/__tests__/travtrack.dawarichImport.test.ts`, Vitest `TravTrackSection.dawarich.test.tsx`

**Schema:** `travtrack_dawarich_imports` — `user_id` PK FK cascade, `import_id` (→ `travtrack_imports`, kind `dawarich`), `status` (CHECK `running|paused|interrupted|complete|incomplete|failed|cancelled`), `from_day`, `until_day`, `next_day` (the durable checkpoint), `days_done`, `report jsonb` (per month `{ read, stored, duplicate, dropped: { privacy_zone, deleted_range, invalid, null_island }, truncatedHours: string[], unreachableDays: string[] }`), `last_error_kind`, `heartbeat_at`. In the database, not in the job: `jobRegistry` is in memory by design, so the job is only the handle for the click; a `running` row with a stale `heartbeat_at` reads as `interrupted`, and `resume` continues from `next_day`.

**Interfaces:**
- Start: own user-tier Dawarich connection only (admin-global/ENV → 409 `DAWARICH_NOT_CONFIGURED`), `on` tier, write scope, `rejectDemo`, one per account (409 `TRAVTRACK_IMPORT_RUNNING`). Range: the whole history (earliest month by the country sweep's backward walk) or a chosen `[fromDay, untilDay]`.
- Per UTC day, oldest first, **one transaction per day = the checkpoint protocol**: read the day from Dawarich (outside the transaction; a truncated day halved down to one hour, an hour still truncated listed in `truncatedHours`, never stored as whole; unreachable → `paused` with the kind, checkpoint kept); then in one transaction under the lock: `fence` = the import row is still `running` with this run's id, else abort; `ingestPoints({ origin: "dawarich:<importId>", deviceId: "dawarich", uploadId: null, outer: tx })` (zones, zone tombstones, deleted ranges and duplicates exactly as every source; `originRef` = the Dawarich point id); `next_day`, `days_done`, the month's report and `heartbeat_at` updated in the same transaction. A crash repeats at most one day, and the repeat is all duplicates.
- **Racing a deletion:** every removal holds the same lock, so a day's transaction runs wholly before or after it; points of a deleted range are refused by ingest (tombstone); deleting the import (E8's delete) sets `cancelled` under the lock and the next day's fence stops the job; "delete all TravTrack data" cancels a running import the same way.
- Report: `complete` only when every day was read whole and each point stored, duplicate or deliberately dropped; otherwise `incomplete` with the truncated hours and unreachable days per month. The web shows totals and the list, never just "fertig".
- After the copy: its days are dirty (projections); no stay, journey or trip detection over the copied span and no prompt (review focus 19). Stop → `paused`, resumable.

- [ ] **Step 1: Failing tests** — "copies a two-month fake history day by day with the report per month"; "a truncated day is subdivided, an hour still truncated is listed and the import ends incomplete"; "Dawarich unreachable pauses with the checkpoint kept; resume stores nothing twice"; "a crash after a day's commit repeats nothing; a crash before it repeats that day as duplicates"; "a stale heartbeat reads as interrupted and resumes"; "a range deleted while the import runs stays empty"; "deleting the import while it runs cancels it: no later day stores a point"; "a point inside a zone or a deleted range is counted dropped"; "a Dawarich point equal to a Companion fix is a duplicate"; "the provider is unchanged"; "nothing is sent to Dawarich but GET /api/v1/points" (fetch spy); "the admin-global connection is refused"; "the copy creates no finding". Web: progress, pause/resume, the incomplete list.
- [ ] **Step 2–4:** FAIL → implement → PASS (`npx jest dawarichImport travtrack.dawarichImport ingest openapi apiResponseShape --forceExit`, `npx vitest --run TravTrackSection localeKeyParity`). **Step 5:** Against the owner's Dawarich on the Beta server (CT 106), one real year: compare the report's totals with Dawarich's own count for that year and record both on the board item. Commit `feat(travtrack): copy the Dawarich history, and say how complete the copy is`.

### Review Focus additions (append to the list at the top)

Phase 4:

26. **No zone shape on the explored map** — one stored and served resolution, and zones shown as explored ground by a fixed neighbour rule; neither a hole nor a resolution change outlines one. Pinned in L1.
27. **Abstention in every figure** — a day without data is `unknown`, never "home", "skipped" or 0 km; cities are `null` unless the user switched the lookup on; a month without points is absent. Pinned in L3, L4, L5.
28. **Projections follow deletion** — explored cells, month values and country days are removed in the removal's transaction and re-derived, acked per day version. Pinned in L1, L3 (E5/E6).
29. **The plan is read, never written.** Pinned in L5.
30. **The Dawarich copy is a copy** — read-only, user-tier connection only, a per-day transaction as the durable checkpoint, fenced by the import's status under the lock so a deletion wins every race, the same pipeline as every source, provider unchanged, and a report that says `incomplete` with the hours and days. Pinned in L6.
31. **Phase 4 is TravTrack `on`** — every view and job answers 403 with TravTrack off; L5 reads through `entryTrack` and is TravPlan-gated. Pinned in each task.

### Phase 4 exit

Per task, not per phase: each L-task lands on `dev/travtrack` with the Build Checks green, `check:drift` green with its migration, a Codex review of its diff, a browser look where it has a screen, and its own single question to the owner when it should reach `main`.

## Phase 5 — Track as an area of its own (owner, 2026-10-25)

Owner, on the Beta: "/track has no main bar, and lacks the controls and views
Dawarich has — in TravTrack's design." Designed and confirmed on the concept
canvas (boards "Bereichswechsel", variant **B**, and "Track-Karte").

**Area switch (variant B).** One header row, never a second one. The logo is
"Trav" followed by the words **Stats · Plan · Track**; the active word is drawn
in its area colour with an underline, the others dimmed and clickable. Then a
divider and the active area's own menu. Area colours: Stats `#f0a947` (today's
`--accent`), Plan `#9aa8ff`, Track `#5ec2b2`. The area follows the route
(`/plan*` Plan, `/track*` Track, everything else Stats). A word appears only
where its area is visible (`useTravPlanVisible`, `useTravTrackVisible`); with
neither, the logo reads "TravStats" as today. Track leaves the "Mehr" menu.

**Track menu:** Karte (`/track`, `/track/:date`), Erkundet (`/track/explored`),
Statistik (`/track/months`), Aufenthalte (`/track/stays`), Importe
(`/track/imports`).

| Step | Scope | Server work |
|---|---|---|
| T5.1 | Header B for all three areas; `/track` and `/plan` render the main bar | none |
| T5.2 | Map tab on today's data: range bar (Heute, Gestern, 7 Tage composed from day reads), live follow (polls `/last-seen`), export/delete; layers routes, points (clickable inspector), heatmap, explored fog, stays and places, logbook entries; route colour by speed (from consecutive safe vertices) or single colour, opacity, client-side split (can only split further); one-day replay that jumps gaps; totals panel and the existing timeline; Importe tab hosts the existing GPX / Dawarich-copy / ingest-token UI | none |
| T5.3 | Monat / Jahr / Zeitraum (bounded, paginated, simplified safe range read); delete one point by id (E5 invalidation); flight panel: altitude series of the segment linked to a flight, photos during the flight by time window (Immich), placed on the safe track by timestamp; Aufenthalte tab; daily calendar in Statistik; countries layer | new endpoints, then UI |

**Privacy, unchanged and binding for every view:** build on safe reads
(`readSafeTravTrack`); never reconnect across a privacy, deletion, pause or
flight-mode cut, in drawing, replay, distance or speed; private zones are never
drawn on the ordinary map (they stay in Settings); a photo inside a zone, or one
whose time falls in a cut, is not shown; a photo's position comes from the safe
track, never from its EXIF.
