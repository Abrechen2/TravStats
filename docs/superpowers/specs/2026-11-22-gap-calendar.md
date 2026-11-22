# Gap calendar — where the logbook is silent

**Origin:** AI-council idea, owner "weiter bauen" 2026-11-22. **Branch:** `fix/gap-calendar`
(server + web). Web only for the Companion's purposes: no app change, API is additive.

## Why

A lifelong logbook is only as good as its holes are visible. The calendar shows, per
day of the account's history, whether anything explains it — so the owner can fill in
what is missing. It makes no claim about days it cannot judge ("abstention is a result").

## Day states, and precedence (first match wins)

A day is a calendar day in the **profile zone** (ADR 0002, `profileZoneOf`; `UTC` while
unset). The window of the history is `firstDay` (earliest entry or fix, any year) to
today in that zone; a day outside it is `outside`, never a gap.

| # | State | Meaning |
|---|---|---|
| 1 | `entry` | A logbook entry covers the day: trip, cruise, lodging stay (DAY precision), flight, rail, bus, ferry, rental, place visit. Cancelled entries and month/year-precision stays do not cover. |
| 2 | `home` | The day has plausible fixes outside every privacy zone, all inside the radius of that day's home-period residence. |
| 3 | `track` | At least one plausible fix outside every privacy zone. |
| 4 | `privacyZone` | Stored fixes exist, but every one lies in a privacy zone (a former zone counts for fixes before its end). Nothing else is revealed: no position, no count. |
| 5 | `implausible` | Fixes exist, none plausible (null island, accuracy over 10 km — the evidence pipeline's `isBadFix`). |
| 6 | `unknown` | None of the above: this is the gap. |

The server answers `outside` for days after today. Entries dated in the future are
still `outside` (not a gap, not a record).

## Contract

`GET /api/v1/gap-calendar?year=YYYY` — bare (ADR 0001), own account, `no-store`.

```
{ year, zone, today, firstDay: "YYYY-MM-DD" | null, years: number[],
  counts: { entry, home, track, privacyZone, implausible, unknown, outside },
  runs: [{ from, to, state }]   // inclusive local days, ordered, cover the whole year
}
```

`firstDay` null: nothing recorded at all (every day `outside`). `years` lists the years
from `firstDay` to today. 400 `VALIDATION_FAILED` for a bad year.

## Aggregation

One round of bounded queries per request, constant in the size of the account: profile
zone, home periods + radius, and ONE SQL statement that builds the year with
`generate_series`, joins the entry spans (one `UNION ALL` branch per domain, local days
computed in SQL) and the day-grouped fixes. No per-day query and no per-day work over
rows in JS: the SQL returns one facts row per day, `classifyDay` (pure) applies the
precedence. The privacy circle test is haversine in SQL with the same radius rule as
`distanceM` (inclusive).

Cache: per `userId|year|zone`, in process, dropped on any write to a source model of
that user (`addWriteObserver`; a write whose user cannot be read from the args drops
every user's entries) and after 5 minutes regardless (raw-SQL ingest is not observed).

## Web

Tab `Lücken` / `Gaps` under Track (`/track/gaps`): year heatmap (12 month rows by 31
day cells, full width, state colours from tokens plus a pattern per state so colour is
not the only signal), year switcher, month drill-down listing its unknown stretches.
Each stretch: "Eintrag anlegen" (domain chooser from `useEnabledDomains`, dates in the
query) and "Tag im Track" (`/track/:date`). The flight form reads `?addFrom=` to
pre-fill the departure date; the other domains open their list with the dates shown
in the notice (Open).

## Not done / open

- Create forms other than the flight form do not read prefilled dates yet.
- Home is a refinement of fixes only; a home period without fixes is not claimed.
