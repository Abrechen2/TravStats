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
| 0 | Spec | done | (this commit) |
| 1 | Schema + budget/rate guard + lookup integration | open | |
| 2 | Admin API + card (tier, spent/budget, tracks switch) | open | |
| 3 | Track fetch, storage and scheduled sweep | open | |

## Contract (additive only)

Filled while building.
