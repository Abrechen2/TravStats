# TravPlan v2 · Part 1 — Route plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TravPlan plan can be a route (stations with nights, stages between them, placeholders
replaced by bookings, variants, weather per station) with the redesigned web UI and a handover
that reconciles into the trip's roadtrip — build-order steps 1–4 of the spec.

**Architecture:** The plan stays one bounded JSON document (`TravelPlan.state`), now `version: 2`
with `shape: "stay" | "route"`; v1 documents upgrade losslessly on read through one function
(`parseState`). New pure modules (scheduler, placeholder matcher, route findings, variants,
fuel estimate) sit beside `rules.ts`; operations stay in the existing receipt/CAS write path.
Routing, place search and climate means are new read/compute endpoints whose results enter the
plan only as ordinary mutations. Handover writes through the roadtrip/ferry/lodging services.

**Tech Stack:** Express + TypeScript + Prisma 7 + zod (backend, Jest with
`jest.travplan.config.cjs` on a loopback `travplan_*` DB), React 19 + Vite + Vitest + MapLibre
(`MapboxOverlay` pattern), react-i18next DE/EN.

**Spec:** `docs/superpowers/specs/2026-10-17-travplan-v2-design.md` (read §4, §5, §11 C1–C4).

## Global Constraints

- Branch `dev/travplan-v2`; never touch `backend/VERSION` or `CHANGELOG.md`; merge `main` in, never rebase.
- No source file over 800 lines (`npm run check:size`); split before you reach it.
- Every new endpoint documented in `services/openapi/paths/travplan.ts` with a response schema; travplan router stays in the **bare** response family (`apiResponseShape.baseline.json`).
- `backend/src/services/travplan/types.ts` and `frontend/src/types/travplan.ts` stay byte-identical (`travplanTypesMirror.test.ts`).
- DE first, EN mirror, same change (`localeKeyParity.test.ts`); server errors are stable codes mapped in `travplan.json` `errors.*` (`travplanErrorCodes.test.ts`).
- TravPlan UI uses only `components/ui` primitives and tokens (`travplanDesignSystem.test.ts`).
- Planned data is never travel evidence; plan-created records carry `externalRef: "travplan:<id>"`.
- Writes to shareable tables call `propagateWrite`/`propagateDelete` or carry `// share-exempt: <reason>` within two lines above.
- Time: no host-local `Date` getters, no zone-less formatting (`time/*` eslint rules); days are `YYYY-MM-DD` strings, use `shared/time/calendar.ts` (`addDays`, `daysBetween`, `formatDayLong`).
- Abstention: unknown values are `null`, never `0` (fuel, toll, distance, estimate).
- Bounds (spec §5.1): stations ≤ 60, stages ≤ 80, variants ≤ 3, station nights 0..60, night candidates ≤ 10, state ≤ 1 MiB.
- Findings limits (spec §5.4): `longDrive` relaxed 300 / balanced 420 / busy 540 minutes; `placeholderDue` info at ≤ 21 days, attention at ≤ 7 days; `ferryConnection` < 120 minutes.
- Placeholder match (spec §5.2): same kind; endpoints ≤ 30 km apart; departure day ±1; lodging overlaps the station's nights.
- Backend tests run with: `cd backend && DATABASE_URL=postgresql://flights_dev:dev_password_change_me_123@localhost:5433/travplan_ux npx jest --config jest.travplan.config.cjs --runInBand <path>` (the disposable DB from 2026-10-17; recreate with `prisma migrate deploy` if missing).

## Review Focus

1. A stored v1 plan from production (any collection filled, `version: 1`) must load, edit and undo after the upgrade — the Companion and prod already hold such rows. → Task 1 fixture test with every collection populated.
2. A user lengthening a station while a ferry is booked later must never see the ferry move. → Task 4 test "anchor never moves; conflict finding instead".
3. Importing the real booking for a placeholder must leave exactly one booking in the budget and every reference intact, and undo must bring the placeholder back. → Task 3 test.
4. Routing unavailable (no provider, 429, timeout) must leave stored metrics untouched and say why. → Task 7 test drives `no_provider` and `rate_limited`.
5. Switching variants must not lose a day trip or a booking. → Task 6 test.

---

## File Structure

Backend (`backend/src/services/travplan/`):
- `types.ts`, `schema.ts` — v2 types and zod (modify).
- `upgrade.ts` — `upgradeV1`, `parseState` (create).
- `routeOperations.ts` — station/stage/night/variant operations (create).
- `placeholders.ts` — `replacePlaceholder`, `matchPlaceholders` (create).
- `routeSchedule.ts` — `scheduleRoute` (create).
- `routeRules.ts` — route findings, called from `rules.ts` `checkPlan` (create).
- `variants.ts` — `createVariant`, `activateVariant`, `compareVariants`, `fuelEstimate` (create).
- `stageRouting.ts` — `routeStage` (create).
- `places.ts` — `searchPlaces`, `currencyForCountry` (create).
- `climate.ts` — `climateMeans` + cache (create).
- `clientCompat.ts` — v1 view/ops for old clients (create).
- `routeHandover.ts` — `reconcilePlanStations`, `executeStation` (create).
- `operations.ts`, `rules.ts`, `store.ts` — wire the above (modify, keep < 800 lines).
- `routes/travplan.ts` + `routes/travplan/routeEndpoints.ts` (create, keeps the router small).
- `services/openapi/paths/travplan.ts` (modify).
- Prisma: model `TravelPlanClimate` (migration via `prisma migrate dev`).

Frontend (`frontend/src/`):
- `types/travplan.ts` (mirror), `lib/api/travplan.ts` (modify).
- `pages/TravPlan/format.ts` — `planDay`, `planRange` (create).
- `pages/TravPlan/PlanContent.tsx` — five sections + header actions (modify).
- `pages/TravPlan/sections/OverviewSection.tsx` (rewrite), `RouteSection.tsx` (create),
  `StaySection.tsx` (replaces `WorkspaceSection.tsx`), `BookingsSection.tsx` (replaces
  `ImportSection.tsx` + `TransferSection.tsx`), `PrepareSection.tsx` (replaces `PackingSection.tsx`),
  `BudgetSection.tsx` (rewrite), `VariantsPanel.tsx`, `PlaceholderReview.tsx`, `PlanMap.tsx`,
  `CreatePlanDialog.tsx`, `PlacePicker.tsx`, `UndoToast.tsx` (create).
- `components/Trips/TravelPlanSummary.tsx` — "Diese Reise planen" (modify).
- `i18n/resources/{de,en}/travplan.json` (modify).

---

### Task 1: Plan state v2 and lossless upgrade

**Files:**
- Modify: `backend/src/services/travplan/types.ts`, `backend/src/services/travplan/schema.ts`, `frontend/src/types/travplan.ts`
- Create: `backend/src/services/travplan/upgrade.ts`
- Modify: every `stateSchema.parse(` call site (store.ts ×10, operations.ts ×2, ai.ts ×2, existing.ts, weather.ts, importPolicy.ts, routes/travplan.ts) → `parseState(`
- Test: `backend/src/services/travplan/__tests__/upgrade.test.ts`

**Interfaces:**
- Produces (types.ts):
  - `PlanPlace { name: string; lat: number; lon: number; country: string | null; zone: string | null; ref: { kind: "port" | "geo" | "place"; id: string } | null }`
  - `PlanNight = { kind: "booked"; bookingId: string } | { kind: "idea"; candidates: PlanNightCandidate[] } | { kind: "pitch" } | { kind: "spontaneous" } | { kind: "onboard" }`
  - `PlanNightCandidate { id: string; title: string; place: PlanPlace | null; url: string | null; note: string }`
  - `PlanStation { id: string; title: string; place: PlanPlace; nights: number; pinnedDay: string | null; night: PlanNight; note: string }` (array order = route order)
  - `PlanStage { id: string; fromStationId: string; toStationId: string; mode: "drive" | "ferry" | "rail" | "flight" | "other"; departDay: string | null; departTime: string | null; durationMinutes: number | null; distanceKm: number | null; metricsSource: "routed" | "straight" | "user" | "booking" | null; fallbackReason: string | null; bookingId: string | null; overnight: boolean; note: string }`
  - `PlanVariant { id: string; name: string; stations: PlanStation[]; stages: PlanStage[] }`
  - `PlanVehicle { kind: "motorhome" | "campervan" | "caravan" | "car" | "motorcycle" | "bicycle" | "other"; lengthM: number | null; consumptionPer100: number | null; fuelPrice: number | null; fuelCurrency: string | null }`
  - `PlanState` changes: `version: 2`; `shape: "stay" | "route"`; `stations: PlanStation[]`; `stages: PlanStage[]`; `variants: PlanVariant[]`; `activeVariantName: string`; `vehicle: PlanVehicle | null`; `roadtripId: string | null`; `stationLinks: { stationId: string; tripStopId: string }[]`; `stationWeather: PlanStationWeather[]` (defined in Task 9, start as `[]` typed `unknown[]` is NOT allowed — define it here: `PlanStationWeather { stationId: string; kind: "forecast" | "climate"; source: string; fetchedAt: string; window: string | null; days: { day: string; min: number | null; max: number | null; rainProbability: number | null; precipitationMm: number | null }[] }`).
  - `PlanBooking` adds `placeholder: boolean`, `estimate: { amount: number; currency: string } | null`, `stageId: string | null`.
  - `PlanItem` adds `stationId: string | null`.
  - `PlanCollection` adds `"stations" | "stages"`.
- Produces (upgrade.ts): `upgradeV1(raw: unknown): unknown` (pure; returns input unchanged when `version !== 1`) and `parseState(raw: unknown): PlanState` (= `stateSchema.parse(upgradeV1(raw))`).

- [ ] **Step 1: Write the failing tests** in `upgrade.test.ts`:
  - `"upgrades a v1 plan with every collection filled losslessly"`: build a v1 object with one entry in each of items, ideas, bookings, transfers, packing, tasks, costs, decisions and a forecast; `parseState(v1)` equals the v1 object plus `{version: 2, shape: "stay", stations: [], stages: [], variants: [], activeVariantName: "A", vehicle: null, roadtripId: null, stationLinks: [], stationWeather: []}`, bookings gain `{placeholder: false, estimate: null, stageId: null}`, items gain `{stationId: null}`.
  - `"leaves a v2 plan untouched"`: `upgradeV1(v2) === v2` (same reference).
  - `"rejects a route station whose stage points at a missing station"`: `stateSchema.safeParse` of a v2 route with `stages[0].toStationId = randomUUID()` → `success: false`.
  - `"rejects more than 60 stations"`.
- [ ] **Step 2: Run** `npx jest --config jest.travplan.config.cjs --runInBand src/services/travplan/__tests__/upgrade.test.ts` → FAIL (`upgrade` module missing).
- [ ] **Step 3: Implement** types, schema (all new objects `.strict()`, bounds from Global Constraints, a `superRefine` on the state checking stage endpoints, `item.stationId`, `night.bookingId`, `stage.bookingId` and `stationLinks.stationId` resolve), `emptyState()` returns v2 `shape:"stay"`, `upgrade.ts`, and swap every `stateSchema.parse(` for `parseState(`. Copy `types.ts` byte-for-byte to `frontend/src/types/travplan.ts`.
- [ ] **Step 4: Run** the upgrade test, then the whole travplan suite (`npx jest --config jest.travplan.config.cjs --runInBand`) → all PASS (existing 23 store + rules + execution tests still green; fixtures that build `version: 1` keep passing through the upgrade).
- [ ] **Step 5: Run** `cd frontend && npx vitest --run src/types src/pages/TravPlan` → PASS (mirror test).
- [ ] **Step 6: Commit** `feat(travplan): plan state v2 with route shape and a lossless v1 upgrade`.

### Task 2: Station, stage and night operations

**Files:**
- Create: `backend/src/services/travplan/routeOperations.ts`
- Modify: `backend/src/services/travplan/operations.ts` (delegate), `schema.ts` (operation union)
- Test: `backend/src/services/travplan/__tests__/routeOperations.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `parseState`.
- Produces: operation variants added to `PlanOperation` (types + zod):
  - `{ type: "route_settings"; shape?: "stay" | "route"; vehicle?: PlanVehicle | null }`
  - `upsert`/`remove` accept `collection: "stations" | "stages"` (same receipt path).
  - `{ type: "move_station"; id: string; toIndex: number }`
  - `{ type: "station_night"; stationId: string; night: PlanNight; place?: PlanPlace }` — `place` replaces the station place only when given (Companion "Tonight here").
- `applyRouteOperation(state: PlanState, op: PlanOperation): PlanState | null` in `routeOperations.ts` (returns `null` when the op is not a route op; `applyOperation` calls it first).
- Rules: removing a station removes stages touching it and clears `stationId` on items (kept as ideas-tray day trips); a `booked` night's booking must be `kind:"hotel"`; `onboard` is accepted only when the arriving stage is `overnight` and `mode:"ferry"` (else 409 `PLAN_INVALID_NIGHT`); changing `shape` to `"stay"` with stations present → 409 `PLAN_SHAPE_IN_USE`.

- [ ] **Step 1: Failing tests:** `"removing a station drops its stages and keeps its day trips"`, `"move_station reorders and keeps ids"`, `"onboard night needs an overnight ferry arriving"` (expect `PLAN_INVALID_NIGHT`), `"booked night must reference a lodging booking"`, `"station_night with place updates the station place"`, `"shape cannot go back to stay while stations exist"`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `applyRouteOperation`; error codes thrown as the module's existing `AppError(409, code)` style used in `operations.ts`; add both codes to `frontend/src/i18n/resources/{de,en}/travplan.json` `errors` (DE: "Diese Übernachtungsart passt nicht zur Anreise." / "Der Plan hat Stationen; entferne sie, bevor er wieder ein Ziel-Plan wird.").
- [ ] **Step 4: Run** the new test and the full travplan suite → PASS.
- [ ] **Step 5: Commit** `feat(travplan): stations, stages and night plans as plan operations`.

### Task 3: Placeholders and their replacement

**Files:**
- Create: `backend/src/services/travplan/placeholders.ts`
- Modify: `operations.ts` (new op), `rules.ts` `deriveBudget`, `schema.ts`, `types.ts` (+ mirror)
- Test: `backend/src/services/travplan/__tests__/placeholders.test.ts`, extend `store.integration.test.ts`

**Interfaces:**
- Produces:
  - op `{ type: "replace_placeholder"; placeholderId: string; value: Record<string, unknown> }`
  - `replacePlaceholder(state: PlanState, placeholderId: string, value: PlanBooking, actorLabel: string | null): PlanState` — keeps the placeholder's `id`, `stageId`; sets `placeholder:false`, `estimate:null`, merges `value`; `details.replaced = { estimate, replacedAt }`.
  - `matchPlaceholders(candidate: PlanBooking, state: PlanState): PlaceholderMatch[]` where `PlaceholderMatch { bookingId: string; score: number; variant: "active" | "inactive"; reasons: ("kind" | "endpoints" | "day" | "nights")[]; differences: { field: string; plan: string | null; booking: string | null; change: "changed" | "new" }[] }`, sorted by score desc, only matches satisfying kind + day ±1 + (endpoints ≤ 30 km when both have coordinates, else normalised-name equality); lodging requires overlap with the station's nights.
  - New endpoint (Task 7 file) `POST /trips/:tripId/plan/placeholder-matches` body `{ booking }` → `{ matches: PlaceholderMatch[] }`.
- Budget: `deriveBudget` adds placeholder `estimate.amount` to `estimates` (never `booked`/`paid`); a placeholder whose `stageId` is not in the active stages is skipped (C2).

- [ ] **Step 1: Failing tests** (`placeholders.test.ts`): `"replacing keeps the id so stage and night still point at it"`; `"budget counts the estimate before and only the booking after"` (estimate 520 EUR → after replace amount 548: `estimates` 0, `booked` 548); `"matches Palermo→Genoa ferry on the day before"` (placeholder day `2027-05-19`, booking `2027-05-20` → 1 match, reasons include `day`); `"does not match across kinds"`; `"does not match ports 80 km apart"`; `"differences mark operator as new and price as changed"`.
- [ ] **Step 2: Failing integration test** in `store.integration.test.ts`: `"replace_placeholder is undoable and restores the placeholder"` (write, undo, `bookings[0].placeholder === true`, `estimate.amount === 520`).
- [ ] **Step 3: Run** both → FAIL.
- [ ] **Step 4: Implement** (`haversineKm` from `services/tour/tourDistance.ts` if exported, else local; names normalised by lowercasing + stripping diacritics + "porto di"/"hafen"/"port of").
- [ ] **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** `feat(travplan): placeholders that an imported booking replaces in place`.

### Task 4: Route scheduler

**Files:**
- Create: `backend/src/services/travplan/routeSchedule.ts`
- Test: `backend/src/services/travplan/__tests__/routeSchedule.test.ts`

**Interfaces:**
- Produces: `scheduleRoute(state: PlanState): RouteSchedule` with
  `RouteSchedule { stations: { stationId: string; arriveDay: string | null; departDay: string | null }[]; stages: { stageId: string; departDay: string | null; arriveDay: string | null }[]; lastDay: string | null; conflicts: { kind: "anchor_shift"; anchorId: string; plannedDay: string; requiredDay: string }[] }`.
- Algorithm (not determined by the signature):
  1. Station 0 arrives `startDay`. For each station i: `departDay = arriveDay + nights`.
  2. Stage from i to i+1 departs `stage.departDay ?? station[i].departDay`; arrival day = depart + (`overnight` ? 1 : floor((departMinute + durationMinutes) / 1440)) where unknown time counts as 0 and unknown duration as 0.
  3. Station i+1 arrives on that arrival day unless `pinnedDay` is set.
  4. Anchors: a booked stage (`bookingId` → non-placeholder booking with a `day`) or `pinnedDay`. When the computed day differs from an anchor's day, use the anchor's day and emit `conflicts.push({kind:"anchor_shift", anchorId, plannedDay: anchorDay, requiredDay: computed})` only when computed > anchor (the route arrives too late). An earlier arrival is a gap, not a conflict.
  5. Without `startDay`, every day is `null`.
- Also produces: `PlanView.schedule?: RouteSchedule` (types + mirror), filled by `view()` in
  `store.ts` for `shape:"route"` plans; Tasks 5, 11 and 15 read it.

- [ ] **Step 1: Failing tests:** the Sicily example from the canvas (start `2027-05-08`; Rosenheim 0 nights → drive → Genoa port 0 → ferry overnight → Palermo arrival `2027-05-09`; Cefalù 3 nights departs `2027-05-12`); `"lengthening a stay shifts later stations"`; `"anchor never moves; conflict finding instead"` (booked return ferry `2027-05-19`, add 2 nights earlier → ferry stays `2027-05-19`, one `anchor_shift` conflict with `requiredDay: "2027-05-21"`); `"no start day gives null days"`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(travplan): route scheduler with booked anchors that never move`.

### Task 5: Route findings

**Files:**
- Create: `backend/src/services/travplan/routeRules.ts`
- Modify: `backend/src/services/travplan/rules.ts` (`checkPlan` appends `routeFindings(state, today)`; `nightGap` uses station nights for `shape:"route"`)
- Test: `backend/src/services/travplan/__tests__/routeRules.test.ts`, extend `rules.test.ts`

**Interfaces:**
- Consumes: `scheduleRoute` (Task 4).
- Produces: `routeFindings(state: PlanState, today: string): PlanFinding[]` with codes and params:
  - `stageUndecided` (info, section `"route"`, params `{from, to, mode}`)
  - `placeholderDue` (info ≤21 days / attention ≤7, params `{title, days}`)
  - `nightUndecided` (info, params `{station}`) — only `idea` with 0 candidates
  - `scheduleConflict` (attention, params `{anchor, plannedDay, requiredDay}`)
  - `longDrive` (info, params `{from, to, hours}`)
  - `ferryConnection` (attention, params `{ferry, minutes}`)
  - `dayTripOutside` (attention, params `{title, station}`)
  - Fingerprints follow the existing `rules.ts` pattern (facts joined), ids `"<code>:<subject id>"`.
- `checkPlan` takes `today` from the store (`store.ts` passes the owner's profile-zone day via the existing clock helper; tests pass a literal).
- DE/EN copy for each code under `findings.*` (DE e.g. `"stageUndecided": "Wie geht es von {{from}} nach {{to}}? Für {{mode}} fehlt noch eine Buchung oder ein Platzhalter."`, `"placeholderDue": "„{{title}}“ ist noch ein Platzhalter – Abfahrt in {{days}} Tagen."`, `"scheduleConflict": "Die Route kommt erst am {{requiredDay}} an, „{{anchor}}“ ist für {{plannedDay}} gebucht."`, `"longDrive": "{{from}} → {{to}} sind etwa {{hours}} Stunden Fahrt."`, `"ferryConnection": "Zwischen Ankunft und Fähre „{{ferry}}“ liegen nur {{minutes}} Minuten."`, `"nightUndecided": "Für {{station}} ist noch kein Platz gemerkt."`, `"dayTripOutside": "„{{title}}“ liegt außerhalb der Tage in {{station}}."`).

- [ ] **Step 1: Failing tests** — one per code; plus `"spontaneous and pitch nights never produce a finding"` and `"nightGap counts station nights on a route plan"`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** full travplan suite + `frontend` `travplanErrorCodes`/parity tests → PASS.
- [ ] **Step 5: Commit** `feat(travplan): findings for routes — undecided stages, due placeholders, anchor conflicts`.

### Task 6: Variants and fuel estimate

**Files:**
- Create: `backend/src/services/travplan/variants.ts`
- Modify: `routeOperations.ts` (ops), `schema.ts`, `types.ts` (+ mirror)
- Test: `backend/src/services/travplan/__tests__/variants.test.ts`

**Interfaces:**
- Produces:
  - ops `{ type: "create_variant"; name: string; copyActive: boolean }`, `{ type: "activate_variant"; variantId: string }`, `{ type: "remove_variant"; variantId: string }`, `{ type: "rename_variant"; variantId: string; name: string }`.
  - `activateVariant(state: PlanState, variantId: string): PlanState` — swaps active `stations/stages` with the variant's (the old active becomes a variant named `activeVariantName`); items whose `stationId` is missing get `stationId: null`.
  - `fuelEstimate(stages: PlanStage[], vehicle: PlanVehicle | null): { amount: number; currency: string } | null` — null unless consumption, price, currency and every drive stage's `distanceKm` are known.
  - `compareVariants(state: PlanState): VariantComparison[]` with `VariantComparison { id: string | null; name: string; active: boolean; driveKm: number | null; driveDays: number; destinationNights: number; stageCosts: { amount: number; currency: string } | null; fuel: { amount: number; currency: string } | null; unknownCosts: number }` — returned in the PlanView as `variants` (add `variants?: VariantComparison[]` to `PlanView`).
- Max 3 variants (409 `PLAN_VARIANT_LIMIT`).

- [ ] **Step 1: Failing tests:** `"switching variants does not lose a day trip or a booking"`; `"fuel estimate is null when any drive distance is unknown"`; `"fuel estimate 2130 km at 11 l and 1.75 €/l is 410.03 EUR"` (rounded to cents); `"fourth variant is refused"`.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(travplan): plan variants with a side-by-side comparison`.

### Task 7: Stage routing and placeholder-match endpoint

**Files:**
- Create: `backend/src/services/travplan/stageRouting.ts`, `backend/src/routes/travplan/routeEndpoints.ts`
- Modify: `backend/src/routes/travplan.ts` (mount), `operations.ts` (op), `services/openapi/paths/travplan.ts`, `apiResponseShape.baseline.json` (assign `routes/travplan/routeEndpoints.ts` to bare)
- Test: `backend/src/services/travplan/__tests__/stageRouting.integration.test.ts`

**Interfaces:**
- Consumes: `resolveRouteProvider(userId)`, `routeLegGeometry(provider, {from, to, mode:"road", vehicle}, providerCallGate(userId))` (`services/tour/routing`).
- Produces:
  - op `{ type: "stage_metrics"; stageId: string; distanceKm: number | null; durationMinutes: number | null; metricsSource: PlanStage["metricsSource"]; fallbackReason: string | null }` — applied only if the stage's endpoints are unchanged since routing (compare coordinates passed in the op as `fromCoord`/`toCoord`; mismatch → 409 `PLAN_STAGE_CHANGED`).
  - `routeStage(userId: string, state: PlanState, stageId: string): Promise<StageMetrics>`; drive → router; ferry → great-circle km, `metricsSource:"straight"`, duration unchanged; rail/flight/other → no routing (`fallbackReason:"unroutable_mode"`).
  - Endpoint `POST /trips/:tripId/plan/stages/:stageId/route` body `{ clientRef, baseRevision }` → PlanView (writes `stage_metrics` through `writePlan`). When the router falls back, the stored metrics are kept unless they were `null` (rule 4 of CLAUDE.md "re-derivation never destroys good data"); response header-free, `fallbackReason` visible in the stage.
  - Endpoint `POST /trips/:tripId/plan/placeholder-matches` (Task 3).
- [ ] **Step 1: Failing tests:** `"no provider keeps stored metrics and records no_provider"`; `"rate limited keeps stored metrics"`; `"a routed drive stores km and minutes"` (stub provider via the module's test seam `resolveRouteProvider` jest.mock); `"stage moved meanwhile is refused with PLAN_STAGE_CHANGED"`.
- [ ] **Step 2–4:** FAIL → implement → PASS, then run `openapi.coverage.test.ts`, `openapi.responseSchema.test.ts`, `apiResponseShape.ratchet.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(travplan): route drive stages through the instance router without losing stored metrics`.

### Task 8: Place search

**Files:**
- Create: `backend/src/services/travplan/places.ts`, `backend/src/services/travplan/countryCurrency.ts`
- Modify: `routes/travplan/routeEndpoints.ts`, openapi paths
- Test: `backend/src/services/travplan/__tests__/places.integration.test.ts`

**Interfaces:**
- Produces: `GET /travplan/places?q=&kind=any|port|stay&language=de|en` → `{ places: PlanPlaceHit[] }`, `PlanPlaceHit { place: PlanPlace; label: string; detail: string; source: "visited" | "port" | "geo"; visits: number; currency: string | null }`.
  - `searchPlaces(userId: string, q: string, kind, language): Promise<PlanPlaceHit[]>` merges, in order: the user's own visited destinations (`LodgingStay`/`TripStop`/flights' airports cities owned by the user, counted as `visits`), `Port` rows (`name`/`city` ILIKE, ≤5), then existing `findLocations` (≤8). De-duplicates within 2 km keeping the higher-ranked source. Zone from the source or `zoneOf(lat, lon)` (`shared/time/zone*`).
  - `currencyForCountry(iso2: string): string | null` — static ISO 3166 → ISO 4217 table covering every country with a single official currency (EU members → EUR).
  - Geocoder failure → hits from the other sources plus `{ degraded: "geocoder_unavailable" }` in the response (never a silent empty list).
- [ ] **Step 1: Failing tests:** `"a port search for Genua returns the port with zone Europe/Rome"`; `"a visited city ranks first with its visit count"`; `"geocoder failure still returns ports and says degraded"`; `"currency for IT is EUR and for CH is CHF"`.
- [ ] **Step 2–4:** FAIL → implement → PASS (+ openapi tests).
- [ ] **Step 5: Commit** `feat(travplan): one place search over visited places, ports and the geocoder`.

### Task 9: Weather per station (forecast + climate means)

**Files:**
- Create: `backend/src/services/travplan/climate.ts`
- Modify: `weather.ts` (per-station forecast), `operations.ts` (op), `backend/prisma/schema.prisma` + migration (`npx prisma migrate dev --name travplan_climate`), openapi
- Test: `backend/src/services/travplan/__tests__/climate.integration.test.ts`, extend `weather.integration.test.ts`

**Interfaces:**
- Prisma `TravelPlanClimate { key String @id; payload Json; fetchedAt DateTime }` (key = `lat2|lon2|MM-DD..MM-DD`, coordinates rounded to 0.5°).
- `climateMeans(lat: number, lon: number, fromDay: string, toDay: string): Promise<PlanStationWeather["days"] | null>` — Open-Meteo archive `daily=temperature_2m_max,temperature_2m_min,precipitation_sum` for the same month-day window in each of the 10 years before `fromDay`'s year, averaged per month-day; cache 30 days; `openDataEnabled` false → `null` with reason `open_data_disabled`.
- Endpoint `POST /trips/:tripId/plan/weather` body `{ clientRef, baseRevision }` → PlanView: for each station with known days, forecast when the window starts within 15 days, else climate; writes op `{ type: "station_weather"; entries: PlanStationWeather[] }`; one weather-quota unit per distinct coordinate fetched (cache hits free). Failure of one station keeps its previous entry and reports `{ failures: { stationId, reason }[] }` in the response (`PlanView & { weatherFailures? }`).
- `source` strings: forecast `"open-meteo-forecast"`, climate `"open-meteo-archive-mean-<y1>-<y2>"`.
- [ ] **Step 1: Failing tests:** `"climate means average ten years per day"` (stub fetch with two years → mean); `"open data disabled gives null and keeps the old entry"`; `"cache hit costs no quota"`; `"one failing station keeps its old weather and is reported"`.
- [ ] **Step 2–4:** FAIL → implement → PASS; run `npm run check:drift` (needs `DATABASE_URL`) → green.
- [ ] **Step 5: Commit** `feat(travplan): weather per station — forecast in range, measured means beyond`.

### Task 10: Old Companion clients (C3)

**Files:**
- Create: `backend/src/services/travplan/clientCompat.ts`
- Modify: `routes/travplan.ts` (read + mutations read header `X-TravPlan-Client`)
- Test: `backend/src/services/travplan/__tests__/clientCompat.test.ts`, extend `store.integration.test.ts`

**Interfaces:**
- `clientVersion(req): 1 | 2` (absent/invalid header → 1).
- `toV1View(view: PlanView): PlanView` — `state.version = 1`, strips v2-only fields; refuses (`409 PLAN_CLIENT_OUTDATED`) when `state.shape === "route"`.
- `fromV1Operation(op: unknown): PlanOperation` — accepts v1 bookings/items without the new fields (defaults), refuses route-only ops.
- DE copy `"PLAN_CLIENT_OUTDATED": "Diese Reise ist eine Route. Bitte aktualisiere die App, um sie zu öffnen."`
- [ ] **Step 1: Failing tests:** `"a v1 client round-trips a stay plan unchanged"`; `"a v1 client gets PLAN_CLIENT_OUTDATED for a route plan"`; `"a v1 upsert without placeholder fields is accepted"`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(travplan): keep installed Companion builds working on stay plans`.

### Task 11: Route handover into the roadtrip (C1)

**Files:**
- Create: `backend/src/services/travplan/routeHandover.ts`
- Modify: `operations.ts`/`store.ts` (op `station_execution` prepared outside the transaction like `prepareExecution`), `execution.ts` (withdrawal for route records — or a sibling `routeWithdrawal` in `routeHandover.ts` to stay < 800 lines)
- Test: `backend/src/services/travplan/__tests__/routeHandover.integration.test.ts`

**Interfaces:**
- Consumes: `replaceStations` (`services/roadtrip/replaceStations.ts`) with `expectedStationIds`; ferry create (`routes/ferry.ts` service functions — extract `createFerryJourney(userId, input, tx)` if only route-local today) and leg link logic from `routes/ferry/roadtrip.ts` (extract `linkFerryToLeg(userId, ferryId, legId, tx)`); lodging/stay builders used by `execution.ts` (`buildStayCreateData`); `recomputeTripStatus`; `propagateWrite`.
- Produces:
  - op `{ type: "station_execution"; stationId: string; execution: "confirmed" | "unconfirmed" }`.
  - `reconcilePlanStations(userId: string, plan: { tripId: string; state: PlanState }, stationId: string, tx): Promise<{ roadtripId: string; tripStopId: string; created: string[] }>`:
    1. Ensure the roadtrip: `state.roadtripId` or create `TripRoute(kind:"roadtrip", tripId, userId, name: plan name, vehicle: state.vehicle?.kind)`.
    2. Read current stops in order; keep every stop not linked in `stationLinks` (phone-appended) where it is, ordered by `startDate`.
    3. Insert/update the station's stop at the position implied by its schedule day; night mapping booked → create `Lodging(type: candidate kind "campsite" when the booking `details.lodgingType === "campsite"` else "hotel")` + `LodgingStay` first, then `night:{kind:"stay", lodgingStayId}`; pitch/spontaneous → `{kind:"free"}`; onboard → `{kind:"pass"}`.
    4. Call `replaceStations(... expectedStationIds = ids just read)`; on `ROADTRIP_STATIONS_CHANGED` re-read once and retry, then 409 `PLAN_ROADTRIP_CHANGED`.
    5. If the arriving stage is a booked ferry: create `FerryJourney` (`externalRef:"travplan:<bookingId>"`) and link it to the leg (mode ferry).
    6. `recomputeTripStatus(tripId)`; return created ids (stored in the item/station `source` for withdrawal).
  - Refuses a station whose `departDay` (from `scheduleRoute`) is after today → 400 `PLAN_EXECUTION_FUTURE` (existing code).
  - Withdrawal (`unconfirmed`) deletes only records it created and that are untouched (`updatedAt` equality, no documents/photos/tracks), then removes the stop from the roadtrip via `replaceStations`; otherwise 409 `PLAN_EXECUTION_EDITED`.
- [ ] **Step 1: Failing tests:** `"confirming a station creates the roadtrip once and keeps a phone-appended stop"` (pre-create a stop via `POST /roadtrips/:id/stations` service `appendCompanionStation`); `"a booked campsite night becomes a campsite stay"` (`Lodging.type === "campsite"`); `"a booked ferry stage becomes a ferry linked to the leg"` (`FerryJourney.roadtripLegId` set, leg mode `ferry`); `"a future station is refused"`; `"withdrawal removes only untouched records"`; `"placeholders never become records"` (C4).
- [ ] **Step 2–4:** FAIL → implement → PASS; also run `backend/src/services/sharing/__tests__/propagate.writePaths.test.ts` (now in the default jest config — run with `npx jest src/services/sharing/__tests__/propagate.writePaths.test.ts`) → PASS.
- [ ] **Step 5: Commit** `feat(travplan): confirming a route station reconciles it into the trip's roadtrip`.

### Task 12: Frontend data layer and date formatting

**Files:**
- Modify: `frontend/src/lib/api/travplan.ts`
- Create: `frontend/src/pages/TravPlan/format.ts`
- Test: `frontend/src/pages/TravPlan/__tests__/format.test.ts`, extend `usePlan.test.tsx`

**Interfaces:**
- `travplanApi` adds: `routeStage(tripId, stageId, write: {clientRef, baseRevision})`, `placeholderMatches(tripId, booking)`, `places(q, kind, language)`, `stationWeather(tripId, write)`; every request sends header `X-TravPlan-Client: 2`.
- `planDay(day: string | null, locale: string): string` → `"Sa, 24. Okt"` (de) / `"Sat, 24 Oct"` (en), `"—"` for null; `planRange(start, end, locale)` → `"Sa, 24. – Do, 29. Okt 2026"`; `nightsLabel(n, t)`. Built on `formatDayLong` with options (UTC, no host zone).
- [ ] **Step 1: Failing tests:** `"planDay formats 2026-10-24 as Sa, 24. Okt in de"`, `"planRange collapses the shared month"`, `"usePlan sends X-TravPlan-Client 2"`.
- [ ] **Step 2–4:** FAIL → implement → PASS (`npx vitest --run src/pages/TravPlan`).
- [ ] **Step 5: Commit** `feat(travplan-web): v2 API client and localised plan dates`.

### Task 13: Plan shell, overview and the v1 fixes

**Files:**
- Modify: `PlanContent.tsx` (sections `overview | plan | bookings | prepare | budget`; old section ids redirect: `workspace→plan`, `import|transfer→bookings`, `packing→prepare`, `ai→overview?ai=1`, `handover→overview`), `planLayout.tsx`
- Rewrite: `sections/OverviewSection.tsx`; create `UndoToast.tsx`
- Test: `frontend/src/pages/TravPlan/__tests__/TravPlanPage.test.tsx` (extend), `OverviewSection.test.tsx` (create)

**Interfaces:**
- Overview shows (canvas board 1): countdown (`daysBetween(today, startDay)`), readiness `done/total` from tasks + top findings, "Als Nächstes" = first 3 findings by severity with their action buttons (finding → section link + `conscious`/`dismiss`), budget card (`total`, `paid`, `due`, `remaining`, budget amount visible), weather strip from `stationWeather`/`forecast`, at-a-glance strip (days for stay plans, stations for route plans), handover card ("Plan für TravStats freigeben").
- Header actions: Bearbeiten, Planungshilfe (opens the AI panel in a `Dialog`), overflow menu (Aktuellen Stand laden, In TravStats ansehen).
- `UndoToast` replaces the permanent undo button: appears for 8 s after an accepted mutation with the mutation summary and "Rückgängig".
- Fixes: dialog title "Neu …" vs "… bearbeiten"; every dialog has "Abbrechen"; empty states with an action for bookings, documents, budget, tasks; item pill "Geplant · verschiebbar" for scheduled activities (not "Flexible Idee"); confirm-as-experienced only when `item.day <= today`; AI request uses `placeholder` + three suggestion chips.
- [ ] **Step 1: Failing tests:** `"old section urls redirect to the five sections"`; `"overview shows the budget amount and the countdown"`; `"undo appears as a toast after a write, not as a permanent button"`; `"a future item offers no confirm-as-experienced"`; `"a scheduled activity is labelled Geplant, not Flexible Idee"`.
- [ ] **Step 2–4:** FAIL → implement → PASS (+ `travplanDesignSystem.test.ts`, parity).
- [ ] **Step 5: Commit** `feat(travplan-web): five sections, a guiding overview and toast undo`.

### Task 14: Create flow, place picker, "Diese Reise planen"

**Files:**
- Create: `CreatePlanDialog.tsx`, `PlacePicker.tsx`
- Modify: `PlanList.tsx` (use dialog; v1 `PlanEditor` stays for edits), `components/Trips/TravelPlanSummary.tsx`
- Test: `__tests__/CreatePlanDialog.test.tsx`, `components/Trips/__tests__/TravelPlanSummary.test.tsx`

**Interfaces:**
- `PlacePicker({ kind, value, onChange: (hit: PlanPlaceHit) => void })` — debounced 250 ms search via `travplanApi.places`; shows source badges ("schon 2× besucht", "Hafen"); a degraded answer shows a notice; picking sets name, lat/lon, country, zone (the "choice carries its data" rule).
- `CreatePlanDialog` step 1: shape toggle (Ein Ziel / Route), destination (stay) or start + destination + "zurück zum Start" (route), date range, travellers stepper, pace chips; shows "Automatisch übernommen: Zeitzone …, Währung …, Wetterort …" with "ändern"; step 2: optional placeholders for the obvious stages (route: one stage per leg, mode chosen) and "Buchung einlesen".
- `TravelPlanSummary`: when no plan exists and `travPlan` is offered → card "Noch kein Plan für diese Reise" + button "Diese Reise planen" (`travplanApi.create(name, {}, tripId)` then navigate).
- [ ] **Step 1: Failing tests:** `"picking Lissabon sets zone Europe/Lisbon and currency EUR"`; `"route create sends start, destination and return stations"`; `"geocoder degraded shows a notice and still lists ports"`; `"a trip without a plan offers Diese Reise planen"`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(travplan-web): guided creation with place search, and planning from any trip`.

### Task 15: Route view

**Files:**
- Create: `sections/RouteSection.tsx`, `sections/route/StationCard.tsx`, `sections/route/StageRow.tsx`, `PlanMap.tsx`
- Test: `__tests__/RouteSection.test.tsx`

**Interfaces:**
- `RouteSection({ ctx })` renders (canvas board 7): stats row (`driveKm`, stage counts, nights by state, day trips, known costs) from `compareVariants` active entry + `scheduleRoute` result (server sends `schedule` in PlanView — add `schedule?: RouteSchedule` to `PlanView` in Task 4's types if not yet), legend, timeline (`StationCard`/`StageRow` alternating), each with state styling via tokens (booked: `info` solid; placeholder: `accent` dashed; spontaneous: neutral dashed; own drive: `good`), candidate list with "Gebucht" (opens booking editor prefilled), day-trip chips + "+ Ausflug", stage actions "Buchung einlesen" / "Selbst eintragen" / "Strecke berechnen" (shows `fallbackReason` copy when straight).
- `PlanMap({ stations, stages })` — MapLibre via the existing `TripMap` component if it accepts arbitrary lines; otherwise a `MapboxOverlay` with a `PathLayer` (drive: solid, ferry booked: solid info, placeholder: dashed accent via `getDashArray`/`PathStyleExtension`) and numbered markers; colours from tokens.
- [ ] **Step 1: Failing tests:** `"stations and stages render in route order with nights"`; `"a placeholder stage shows Buchung einlesen"`; `"a straight-fallback stage explains why"`; `"spontaneous night shows no warning"`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(travplan-web): route view with stations, stages, states and a route map`.

### Task 16: Stay view (all days, ideas tray, map)

**Files:**
- Create: `sections/StaySection.tsx` (replaces `WorkspaceSection.tsx`, which is deleted), `sections/stay/DayCard.tsx`, `sections/stay/IdeasTray.tsx`
- Test: `__tests__/StaySection.test.tsx`

**Interfaces:**
- View switch "Alle Tage | Ein Tag" (state in URL `?view=`); each day card: localised heading, weather pill, items with time range (`time` + `duration`), place, pill, and gap lines between consecutive items with places ("X Min. zu Fuß" only when a stage/transfer duration exists — never invented); free day dashed card.
- `IdeasTray`: chips; HTML5 drag onto a `DayCard` dispatches `assign_idea`; every chip also has a "Einplanen" button (keyboard/touch path, `useCoarsePointer`).
- [ ] **Step 1: Failing tests:** `"all days render with weekday headings"`; `"dropping an idea on a day assigns it"`; `"the assign button works without drag"`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(travplan-web): every day at a glance with an ideas tray`.

### Task 17: Bookings section with placeholder review

**Files:**
- Create: `sections/BookingsSection.tsx`, `PlaceholderReview.tsx`; delete `ImportSection.tsx`, `TransferSection.tsx` (transfers move into BookingsSection as a sub-card)
- Modify: `ImportPanel.tsx` (after drafts: call `placeholderMatches` per draft)
- Test: `__tests__/PlaceholderReview.test.tsx`

**Interfaces:**
- `PlaceholderReview({ draft, matches, onReplace, onAdd, onPickOther })` — canvas board 8 left: banner "Passt zum Platzhalter …", diff table (`differences` with `changed` → accent, `new` → good), consequence line, retain-original checkbox, buttons *Platzhalter ersetzen* (→ `replace_placeholder`), *Als zusätzliche Buchung* (→ `upsert`), *Anderen Platzhalter wählen* (select among matches).
- Bookings list shows placeholders with estimate and dashed style; empty states.
- [ ] **Step 1: Failing tests:** `"a matching draft offers replace and sends replace_placeholder"`; `"choosing additional booking upserts instead"`; `"changed and new fields are marked"`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(travplan-web): an imported booking replaces its placeholder after review`.

### Task 18: Variants, prepare and budget sections

**Files:**
- Create: `VariantsPanel.tsx`, `sections/PrepareSection.tsx` (replaces `PackingSection.tsx`)
- Rewrite: `sections/BudgetSection.tsx`
- Test: `__tests__/VariantsPanel.test.tsx`, `__tests__/BudgetSection.test.tsx`

**Interfaces:**
- `VariantsPanel` (header action "Variante vergleichen" on route plans): comparison cards from `view.variants`, "Aktivieren", "Neue Variante (Kopie)", rename/remove; unknown costs shown as "offen", never 0.
- `PrepareSection` (board 4): packing templates row (Städtereise, Strand, Wandern, Mit Kind as static template lists in `pages/TravPlan/packingTemplates.ts`, DE/EN labels; "Aus <frühere Reise>" lists the user's other plans' packing via `travplanApi.list` + `get`), packing list grouped by category with progress and scope filter, suggestions with "+ Packen", tasks (the only place tasks are listed besides the overview readiness).
- `BudgetSection` (board 5): four stat tiles (budget with per-person, known total, due, remaining with "reicht für …" only when a nightly estimate exists), category bar by booking kind/cost kind, table of all posts incl. placeholders ("geschätzt") and unknown prices ("Preis offen"), fuel estimate row on route plans.
- [ ] **Step 1: Failing tests:** `"activate swaps the active route"`; `"unknown variant costs show offen"`; `"a placeholder appears as geschätzt in the budget table"`; `"applying a template adds its items without duplicates"`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(travplan-web): variants, preparation and a budget that names what is unknown`.

### Task 19: Docs, full gates and a browser look

**Files:**
- Modify: `docs/features/travplan.md` (v2: shapes, placeholders, scheduler, handover, client compat), `frontend/src/config/betaFeatures.ts` (`travPlan` entry `why`/`returnsWhen` updated to "route plans complete incl. co-planning")
- Test: none new

- [ ] **Step 1:** Run backend gates: `cd backend && npx tsc --noEmit && npm run lint && npx jest --config jest.travplan.config.cjs --runInBand` → all PASS.
- [ ] **Step 2:** Run frontend gates: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run` → PASS.
- [ ] **Step 3:** Run repo checks: `DATABASE_URL=… npm run check` (size + drift) → PASS.
- [ ] **Step 4:** Browser look on the disposable instance (`scripts/travplan-preview.ts` + `vite.travplan.config.ts`): create the Sicily route from the canvas (start Rosenheim 2027-05-08, Genoa port, ferry placeholder, Palermo, Cefalù 3 nights idea, Agrigent 2 spontaneous, Syrakus 3, Taormina 2 pitch, ferry placeholder back, Genoa stop, Rosenheim) and the Lisbon stay plan; screenshot every section at 1366×1024 and 390×844; compare against boards 1–8; fix deviations.
- [ ] **Step 5: Commit** `docs(travplan): v2 route plans` and push the branch: `git push origin dev/travplan-v2 && git push forgejo --all`.
