# Home: one source — residence periods (2026-11-01)

Owner, 2026-11-01: „Wohnort und Heimat ist das selbe, aber die rückwirkend
zählenden benötigt es weiterhin mit den Umzügen … lasse es Companion anpassen."

## Decision

The home periods (`user_settings.data.homePeriods`, `utils/homeAirport.ts`
`HomePeriod`: fromDate, toDate, residence {name, lat, lon, placeRef}, 1–3
airports) are the one record of where someone lives. They stay, because past
trips count against the home of their day (moves). `homePlace` stops being a
second, separate value: **the home place is the residence of the current period**
(`currentPeriod(periods).residence`).

## Server (phase S1)

| Change | Detail |
|---|---|
| Read | `GET /settings/personal` keeps returning `homePlace` (additive compatibility), now derived from the current period's residence. Falls back to the legacy `user_settings.home_place` column only when there is no current period with a residence. `zone` is resolved from the residence coordinates as today. |
| Write | `PUT /settings/personal` with `homePlace` (old apps): writes the residence of the current period (keeps its airports and dates). With no current period, it stores the legacy column as today and returns `homePlaceSource: "legacy"`. |
| Readers | TravTrack day context, TravTrack share-narrowing (`shareNarrow`, `travtrack_share_past_homes`) and the data export read the derived value; past-home narrowing may read past periods directly. |
| New field | `homePlaceSource: "period" | "legacy"` on `GET /settings/personal`, additive. |
| Migration | none required; the legacy column stays read-only fallback. Dropping it needs a plan entry naming the app version that stops writing it. |

## Companion (phase C1)

- Stop keeping the home place device-only (`travstats.homePlace` in AsyncStorage). Read it from `GET /settings/personal` (`homePlace`), cache it, and use it for "time to leave".
- Editing the home in the app edits the current period's residence via `PATCH /settings/home-airports/:index` (or `PUT /settings/home-airports/periods`) — the same record the web edits. A move ("ich ziehe um") is a new period, not an overwrite.
- An account with no period: offer to set the home (creates the first period; airports are required — the app may suggest the nearest).
- Minimum server version: the 2.8.0 RC that ships S1.

## Open for Companion

- Confirm which endpoint the app prefers for editing (PATCH one period vs PUT all).
