# The passport exists in the Companion and not here — handoff, 2026-08-29

Written from the **TravStatsCompanion** side. Nothing in this repository has
been changed; this is a request with the homework already done.

## What this is about

The Companion has a **Reisepass** screen: a paper-styled card with stamps, a
continent quota band, and the country table underneath. It has been drawn
(`ClaudeDesign/screenshots/03b-reisepass.png`), built, and is in daily use on
the phone.

This server has no equivalent. The only occurrence of the word anywhere in
`frontend/src` or `backend/src` is an achievement seed called
`Passport Starter` (`backend/src/data/achievementSeeds/partA.ts:176`). Searched
on 2026-08-29 — there is no passport page, no passport endpoint, no passport
component.

**That is worth changing, and it is cheap**, because of the finding below.

## The finding: the data is already here

The Companion does not ask this server for a passport. It builds the whole
screen client-side from **two endpoints that already exist**:

```
GET /api/v1/stats/airports
GET /api/v1/flights
```

Everything on the screen is derived from those two answers. Nothing else is
fetched, and no field is invented. Concretely, in
`app/src/lib/server/adapters.ts`:

| Function | What it produces |
|---|---|
| `passportSummaryFromServer(stats, flights)` | countries, airports, entries, continents visited/total, first stamp year, "new this year" |
| `countryRowsFromFlights(flights)` | one row per country: entries, period ("2005–2026"), its airports, home flag, new flag |
| `continentQuotasFromRows(rows)` | visited/total per continent |
| `passportStampsFromFlights(flights)` | the stamps on the paper card: IATA + a mono month label |

The shapes are in `app/src/components/passport/types.ts`.

## The one place the two sides already agree — keep it that way

`app/src/lib/continents.ts` buckets countries into continents, and its own
header says it deliberately mirrors **this repo's** table in
`backend/src/utils/stats/airportStats.ts`. It also carries a decision from the
mockup that a server implementation has to know about:

> Africa and Antarctica are ONE bucket (`AF`), because `03b` draws them as one
> row. The label is "Afrika · Antarktis".

An unknown country code falls into `AF` **only if it genuinely maps there**;
otherwise it is reported as unknown and left out of the quotas rather than
silently inflating a continent. If the server grows its own passport, that rule
has to survive, or the two products will disagree about how many continents
somebody has been to — which is the sort of divergence nobody notices until a
headline number is wrong on one screen and right on the other.

## Two ways to do it, and a preference

**(a) Frontend-only.** Port the four functions above into the web frontend and
render the page. Nothing changes in the API. Fastest, and it duplicates the
derivation — a third copy of the continent rule after the Companion's and this
repo's.

**(b) `GET /api/v1/stats/passport`.** Compute it here, once, and let both
clients render it. Slower to start, and it is the version that makes the
duplication go away: the Companion would drop its own derivation and read the
endpoint, which is what it does for every other figure it can.

**Preference from this side: (b)**, but only if the endpoint returns the
*derived* shapes above rather than raw rows the clients re-aggregate. If it
comes back as "here are your flights again", (a) is honestly better.

Either way the Companion is happy to move first or second — it already works,
so there is no deadline pressure from here.

## What the server would gain that the Companion cannot do

Two things, both out of reach on a phone and both natural on the web:

- **Print / export.** A passport is the one screen in this product people would
  plausibly want on paper or as a PDF.
- **The full country table.** The Companion shows the countries and a detail
  page per country (`04a`, `04d`); a desktop table can show entry dates,
  airports and cruise ports side by side without paging.

## What NOT to build

From the Companion's own scars, three things the data does not support:

- **No "countries of the world" percentage** unless somebody picks the
  denominator on purpose and writes it down. 197? 193? The mockup's continent
  totals (`CONTINENT_TOTALS` in `continents.ts`) are one answer and they are
  the mockup's, not a standard.
- **No stamp for a country without a flight or a port call.** A stamp is an
  arrival that happened. A planned trip is not a stamp — the Companion keeps
  future-dated things out of every total, and the server's own
  `shared/placeCounting.ts` applies the same rule to places.
- **No flags as the primary identifier.** The Companion uses the ISO code as
  the glyph. Flags are political, get out of date, and render inconsistently
  across platforms.

## Reading list

In `TravStatsCompanion`:

- `app/src/app/(tabs)/passport.tsx` — the screen
- `app/src/components/passport/` — the components and their types
- `app/src/lib/server/adapters.ts` — the four derivations named above
- `app/src/lib/continents.ts` — the bucketing and the `AF` rule
- `ClaudeDesign/screenshots/03b-reisepass.png` — the drawing
- `ClaudeDesign/screenshots/04a-laender-detail.png`, `04d-laender-liste.png` —
  the country pages that hang off it

## Status

Filed, not committed. This file was written by the Companion session; the
commit is left to whoever owns this repository's HEAD, because another session
moves it.
