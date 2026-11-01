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
| Move (new) | `POST /settings/home-airports/periods` appends `{fromDate, residence, airports, clientRef}`: closes the open period the day before `fromDate`, idempotent on `clientRef` (same ref → same answer, no second period). 409 `HOME_PERIOD_OVERLAP` when `fromDate` is not after the open period's start. Also creates the first period when there is none. (Option (a), chosen 2026-11-01 for the Companion's offline outbox.) |
| Migration | none required; the legacy column stays read-only fallback. Dropping it needs a plan entry naming the app version that stops writing it. |

## Companion (phase C1)

- Correcting where I live: the app keeps `PUT /settings/personal {homePlace}` through its outbox; S1 maps it onto the current period's residence. (The app already reads the home place from the server since 2026-10-23, companion audit C4.)
- A move ("Ich ziehe um") and the first period: `POST /settings/home-airports/periods` with a `clientRef`.
- `homePlaceSource: "legacy"`: show "Wohnort gilt noch nicht rückwirkend" and offer the first period (airports required, nearest suggested).
- Minimum server version: the 2.8.0 RC that ships S1.

## Answered

- Companion 2026-11-01: PATCH /:index and PUT-all are unsafe from an offline outbox; chosen: append endpoint with clientRef (option a).
