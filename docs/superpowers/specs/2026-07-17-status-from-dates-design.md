# Status from dates — design spec

Date: 2026-07-17
Status: approved (owner, 2026-07-17 — architecture B "materialized derivation";
running state for cruises + trips only)
Release: rides 2.5.0.
Branch: feat/status-from-dates

## Why

Alex (Discord 07-12): status should follow from the timestamps — check-in past +
check-out future = running, both past = completed, both future = planned — with only
"Cancelled" remaining a manual input. Today's stored statuses are user-editable and can
contradict the dates, which is exactly where the zombie-flip phantom anomalies come from
(`feedback_zombie_auto_flip`). Two conservative one-way auto-flips already exist
(`flightAutoUpdate.ts` transitionZombieFlights, `cruiseStatusTransition.ts`
transitionPastCruises) — they are the seed of this design, not its enemy.

## Owner decisions (fixed)

- **Architecture B — materialized derivation.** The stored `status` columns STAY and
  every consumer (stats, achievements, filters, map) keeps reading them unchanged. What
  changes is who writes them: write paths derive the value from the dates, an hourly
  sweep + boot run keeps it consistent, and the user can no longer set the temporal
  status by hand. Only "Storniert" remains a user input (checkbox); `historical` and
  `duplicated` remain import/system semantics (not date-derivable, untouched).
- **Running state ("Unterwegs") for CRUISES and TRIPS only.** Flights stay
  scheduled/flown (a 2h flight is effectively never visibly "running"); cruises get the
  new `in_progress` status between start and end; trips' existing
  `planned/in_progress/completed` becomes derived instead of hand-maintained.
- Pure derivation (approach A) rejected: `historical`/`duplicated` are not
  date-derivable and ~15 backend query sites + stats/achievements would need
  date-condition rewrites — too invasive for the same user-visible result.

## 1. Derivers (pure functions, one source of truth)

New `backend/src/shared/statusDerivation.ts` (backend-owned; a frontend mirror is NOT
needed — the frontend only displays what the API returns):

```ts
deriveFlightStatus(input: {
  departureTime: Date | null; arrivalTime: Date | null;
  current: string;                  // stored status
  now?: Date;
}): "scheduled" | "flown" | <passthrough>
```
- `cancelled`, `historical`, `duplicated` pass through UNCHANGED (never derived).
- With a usable end signal (arrivalTime, else departureTime): past (with slack) →
  `flown`, otherwise `scheduled`. Slack: 24h beyond the end signal, matching the
  existing zombie-flip conservatism (read its exact cutoff and reuse it).
- No dates at all → keep `current` (nothing to derive from).

```ts
deriveCruiseStatus(input: { startDate: Date | null; endDate: Date | null;
  current: string; now?: Date }):
  "scheduled" | "in_progress" | "flown" | <passthrough>
```
- Same passthroughs. start > now → `scheduled`; start ≤ now ≤ end (+48h slack, the
  existing PAST_CRUISE_CUTOFF_HOURS) → `in_progress`; past end+slack → `flown`.
- Missing endDate: derive from startDate only (start past → `flown` after slack;
  no `in_progress` without an end).

```ts
deriveTripStatus(input: { earliestStart: Date | null; latestEnd: Date | null;
  now?: Date }): "planned" | "in_progress" | "completed" | null
```
- Computed from the trip's segments (flights' departure/arrival, cruises' start/end).
  `null` when the trip has no dated segments — then the stored value stays (empty trips
  keep whatever they have; default remains "completed" per schema).

DATE_ONLY semantics: flights whose times are date-only still carry a Date in
`departureTime`/`arrivalTime` — the 24h slack absorbs the timezone fuzz; no special
handling beyond the slack.

## 2. Write paths derive

- Flight create/update (`routes/flights.ts`), batch import (`routes/flightsBatch.ts`),
  and any parser-driven create that sets status: after validating input, status is
  computed via `deriveFlightStatus` — EXCEPT when the incoming status is
  `cancelled`/`historical`/`duplicated` (those remain settable; `cancelled` via the new
  checkbox contract, `historical`/`duplicated` via import/dedupe flows).
  The Zod schemas keep accepting the full enum (API compatibility; the App and
  scripts send statuses) — but `scheduled`/`flown` inputs are treated as HINTS and
  overridden by the derivation. Document this in the schema comment and the OpenAPI
  description.
- Cruise create/update (`routes/cruises.ts`): same with `deriveCruiseStatus`.
- Trip create/update + segment link/unlink (`routes/trips.ts`, tripDetectionService,
  flightsBatch trip auto-creation): recompute `deriveTripStatus` from the trip's
  segments after the mutation; keep stored value when the deriver returns null.
  The trip PATCH schema DROPS user-settable `status` (frontend no longer sends it);
  if a request still carries it, it is ignored (log at debug, not an error — the
  mobile app may lag a release).

## 3. Hourly sweep (generalizes the two existing flips)

`backend/src/services/statusSweep.ts` — `sweepStatuses()`:
- Flights: bidirectional for `scheduled` ↔ `flown` ONLY (never touches
  cancelled/historical/duplicated). Implemented as two `updateMany` calls with date
  conditions (like today's zombie flip, plus the reverse direction for future-dated
  rows wrongly marked flown). Keeps writing `lastModifiedBy: "status_sweep"` on
  flipped flight rows (renames the "zombie_auto_flown" marker for NEW flips; existing
  markers stay — diagnostics only).
- Cruises: scheduled/in_progress/flown three-way from start/end (+slack), same
  passthrough rules.
- Trips: recompute for all trips with ≥1 dated segment (findMany with segment date
  aggregates, update only rows whose derived value differs).
- Wired: hourly cron (same idiom as `airlineLogoRefreshScheduler`) + one run at boot
  (this IS the backfill — first boot after deploy converges all existing rows; the
  run logs per-entity flip counts).
- `transitionZombieFlights` and `transitionPastCruises` are RETIRED (deleted, their
  call sites rewired to the sweep) — the sweep subsumes both. Their tests migrate to
  the sweep's suite.

## 4. Frontend

- **FlightEditModal / FlightReviewModal / FlightCompleteStep**: the status dropdown is
  REPLACED by (a) a read-only derived-status pill and (b) a "Storniert" checkbox
  (checked = send `status: "cancelled"`, unchecked on a previously-cancelled flight =
  send `status: "scheduled"` and let the backend re-derive). `historical` rows show
  their pill; the checkbox still works for them (cancelling a historical flight is
  legitimate); un-cancelling returns them to derivation.
- **CruiseEditModal**: same pattern; new `in_progress` pill (DE "Unterwegs" /
  EN "Under way") added to `cruiseStatusPillStyle` and everywhere cruise status
  renders (list rows, detail page, tooltips — follow `cruiseStatusPillStyle`
  consumers).
- **TripModal**: the status select is removed entirely (trips derive; there is no
  cancelled for trips). The trips list's existing filter chips (Alle/Geplant/Aktuell/
  Abgeschlossen) keep working — "Aktuell" now actually matches derived `in_progress`.
- Flight status FILTERS (table, map) are untouched — same values as before.
- i18n DE + EN together for every new/changed string.

## 5. Testing

- Deriver unit tests: all three functions — passthroughs (cancelled/historical/
  duplicated), boundary times around the slack windows, missing-date cases,
  DATE_ONLY-ish midnight dates, trip null-return.
- Sweep tests (real DB): seeds one row per state-transition case per domain, runs
  `sweepStatuses()`, asserts flips + non-flips (cancelled stays, future flown reverts
  to scheduled, cruise enters/leaves in_progress); idempotent second run flips 0.
- Write-path tests: create a flight with future dates + `status: "flown"` hint →
  stored `scheduled`; create with past dates → `flown`; `cancelled` respected;
  cruise create spanning now → `in_progress`; trip PATCH with `status` → ignored.
- Existing suites that SET statuses in fixtures keep working (they write via prisma
  directly, which the derivation does not intercept — only routes derive). Suites
  that create flights via routes with hint statuses may need their expectations
  aligned (they asserted the hint; now they assert the derivation) — adapt intent.
- Frontend: modal tests (checkbox sends cancelled/scheduled, no status select
  rendered), cruise pill test for in_progress, trips filter test.
- Full gates + browser UAT (edit modals, cruise list pill, trips "Aktuell" filter).

## 6. Out of scope

- Flight "in the air" state (owner decision).
- Hotel/lodging statuses (2.6 — the deriver module is the extension point).
- Achievements/stats logic changes — they read the same column values as before
  (`in_progress` cruises: verify the cruise stats treat non-`flown` as not-completed
  already; if a cruise stat counts `flown` only, an in-progress cruise simply doesn't
  count yet, which is correct).
- Historical/duplicated semantics, import flows that set them.
- Removing the status columns or Zod enum values (API compatibility).

## 7. Risks / gotchas

- **Mobile app compatibility**: TravStatsApp sends status on create/update. Treating
  scheduled/flown as hints (silently derived over) keeps old app versions working;
  NEVER 400 on a status field.
- **Achievements monotonicity** (`feedback_achievement_engine_monotonic`): the sweep
  can flip flown→scheduled for future-dated rows, reducing counts — achievements are
  NOT auto-revoked by design; no new handling needed, but the whole-branch review
  should confirm the sweep triggers no achievement recalc storms (the existing flips
  didn't either).
- **The cruise stats/achievements read `flown`** — an `in_progress` cruise drops out
  of "scheduled" filters and is not yet "flown"; check every cruise list/filter UI
  handles the third value (search for hardcoded scheduled/flown branching in cruise
  components).
- **Demo seed** (`seedDemoUser`) sets statuses explicitly via prisma — untouched by
  derivation, but the boot sweep will converge them; the seeded 2026 "Geplant" rows
  must genuinely have future dates or they'll flip (they do — seed uses relative
  dates; verify once in UAT).
- Sweep + write-path double-derivation is idempotent by construction (same pure
  function).
- Do NOT touch `depTimeSemantics`/`arrTimeSemantics` handling; the deriver consumes
  the stored Date values as-is with the slack absorbing semantics fuzz.
