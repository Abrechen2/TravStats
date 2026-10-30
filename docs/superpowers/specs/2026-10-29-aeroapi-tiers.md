# FlightAware AeroAPI: tier/budget guard and real flight tracks (forgejo#409)

**Owner request 2026-10-29:** make better use of FlightAware AeroAPI, which TravStats already speaks
(`services/aeroapiLookup.ts`, flight status, 10 days back / 2 ahead). The owner feeds FlightAware from his own receiver.

**Facts (FlightAware pricing page, checked 2026-10-29):** Personal tier, no minimum fee, 10 result sets/minute,
personal/academic use only; monthly usage credit up to $5, **up to $10 for ADS-B feeder hosts** (applied after contacting
FlightAware support). Historical flight data is NOT in Personal (Standard, $100/month minimum) — out of scope.

## Plan

1. **Tier + monthly budget guard.** Admin picks Personal / Personal feeder / Custom; the monthly USD budget is $5 / $10 /
   the custom number. Every AeroAPI call is costed and counted per UTC calendar month; at the budget the provider answers a
   distinct `quota` outcome and the chain falls through — never a surprise bill. Admin sees spent / budget.
2. **Real flight tracks.** For a flight that departed within AeroAPI's window, fetch `GET /flights/{fa_flight_id}/track`
   once after arrival and store it in the flight's track row (`flight_tracks`, source `aeroapi`), only when the flight has
   no track yet (a device-recorded or uploaded track always wins). Opt-in switch, default off (forgejo#392 rule),
   budget-guarded.
3. **Rate limit** 10 result sets/minute respected.

Ledger: 2.8.0 RC line if the owner wants it in rc.2, else 2.9.0.

## Phases

| # | Phase | Status | Commit |
|---|-------|--------|--------|
| 0 | Spec | done | a58deb3e8 |
| 1 | Schema + budget/rate guard + lookup integration | done | 735c415e8 |
| 2 | Admin API + card (tier, spent/budget, tracks switch) | done | 735c415e8 (API), 848047d71 (card) |
| 3 | Track fetch, storage and hourly sweep | done | 735c415e8; review fixes (race-safe yield, per-airport match, retry accounting) in the next commit |

## Contract (additive only)

Server version: the version that ships this plan. No installed app breaks: nothing is removed or renamed.

- **`GET /flights/:id/track`** — `track.source` can now be `"aeroapi"` (a server-fetched FlightAware line;
  `uploadId` is `aeroapi:<fa_flight_id>`, `deviceId` null). Clients must treat an unknown source as display-only.
- **`POST /flights/:id/track`** (Companion upload) and **`POST /flights/:id/track/file`** — when the stored
  track has `source: "aeroapi"`, the upload REPLACES it without `replace: true` (answer `201`, as for a first
  recording). Against any other stored track nothing changes: `409 TRACK_ALREADY_RECORDED` unless `replace`.
- **`GET /admin/aeroapi`, `PUT /admin/aeroapi`** (admin only, not in the public OpenAPI, bare shape):
  `{ tier: "personal"|"personal_feeder"|"custom", customBudgetUsd: number|null, tracksEnabled: boolean,
  usage: { month, spentUsd, budgetUsd, calls, exhausted }, costUsd: { flights, track },
  lastTrackSweep: { at, status, counts } | null }`. PUT takes any subset of `tier`, `customBudgetUsd`,
  `tracksEnabled`; `tier: "custom"` without a budget above zero is `400 AEROAPI_BUDGET_REQUIRED` (field
  `customBudgetUsd`).
- **Lookup outcome** — AeroAPI at its budget or rate limit records the existing `quota` outcome; the chain falls through.

## As built

- Budget: `aeroapi_usage` (month `YYYY-MM` UTC, whole milli-dollars). A call reserves its cost in ONE conditional
  upsert BEFORE the request; an HTTP error answer (nothing billed) refunds it, a timeout stays counted.
  Costs: status query 5, track 10 milli-dollars (`AEROAPI_COST_MILLI_USD`; unverified until an invoice is compared).
  The budget models the INSTANCE's FlightAware account: a call made with a user's own key reserves and counts
  nothing and is never refused by it (it bills that user's account); only the 10/min rate limit applies, per key.
- Rate: 10 result sets / minute, in memory (a lookup waits at most 2 s for a slot, the sweep up to 65 s).
- Tracks: hourly sweep (`jobs/aeroapiTrackScheduler.ts`, minute 17), off until `aeroapiTracksEnabled`. Candidates:
  past arrival + 1 h, departed within 10 days, real (non-placeholder) times, not cancelled, no track, no final answer
  in `aeroapi_track_attempts`. Two result sets per flight (status to find `fa_flight_id`, then the track). Terminal
  outcomes (`stored`, `no_match`, `no_track`, `has_track`) are never asked again; transient ones (`budget`,
  `rate_limit`, `error`, `not_arrived`) are retried up to 3 times. Auth, budget and rate-limit failures stop the sweep.
- The sweep runs with the instance key only (admin global or env), never a user's.
