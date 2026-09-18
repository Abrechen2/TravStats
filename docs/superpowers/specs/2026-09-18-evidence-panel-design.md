# Evidence panel — which entries produced this number

**Status:** design approved by the owner on 2026-09-18.
**Branch:** `dev/design-system`.

## The request

> "es fehlt die Detail seite bei den Erfolgen und statistiken für die jeweiligen
> einträge. Welche einträge haben den Erfolg oder Statistik ausgelößt usw"
> — owner, 2026-09-18

Every number on the Achievements and Statistics pages is currently a dead end.
The user sees "21 Länder", "124 von 275 Erfolgen", "Vielflieger: 10 Flüge" and
has no way to ask which of their entries produced it. This feature answers that
question, everywhere, in one shape.

## Owner decisions taken before design

Asked and answered on 2026-09-18:

| Question | Decision |
|---|---|
| How does the detail open? | A side panel, full-screen sheet on phones. Not a separate route, not an inline expander. |
| Which surfaces? | All four: achievements, headline metrics, rankings, records/superlatives. |
| Where does the evidence come from? | A backend endpoint per metric — never a frontend re-filter of an already-loaded list. |
| What about numbers with no per-entry evidence? | Say so honestly, with the reason. ("Abstention is a result".) |
| Which branch? | `dev/design-system`. |

## Goal

One question — *which entries produced this number?* — answered by the same code
that produced the number, for every number a user can see on those two pages.

## Non-goals

- Not an export. The panel links into the logbook; it does not become a second
  table with its own filters.
- Not a new statistics page. No number is added, moved or re-defined by this
  work, with one exception named below (the cross-currency record, which is a
  defect the panel would otherwise put on display).
- Not a permission boundary. Evidence is the caller's own data, read-only; it
  needs no new guard beyond `authenticate`.

## The contract

One response shape for all four kinds. Four bespoke shapes would be four
features to maintain and four places for the number and its evidence to drift.

```
GET /api/v1/evidence/:kind/:key
    kind ∈ "achievement" | "metric" | "ranking" | "record"
    key  — the achievement code, the metric id, the ranking row's key, the record id
    query: year?   (the statistics page's year filter, passed through unchanged)
```

```ts
interface EvidenceResponse {
  metric: {
    kind: EvidenceKind;
    key: string;
    /** Already-localised label of the number, as the tile shows it. */
    label: string;
    /** The number itself — the panel repeats it, so a drift is visible. */
    value: number;
    /** "flights" | "nights" | "countries" | "km" | … — decides the unit line. */
    unit: string;
  };
  entries: EvidenceEntry[];
  /** Entries before the cap; `entries.length` may be smaller. */
  total: number;
  truncated: boolean;
  /**
   * The honest gap. Present whenever `sum(contribution) < value`, absent when
   * every unit of the number has a row behind it.
   */
  unattributed?: { count: number; reason: UnattributedReason };
}

interface EvidenceEntry {
  domain: "flight" | "cruise" | "lodging" | "place" | "trip";
  id: string;
  /** "LH2080 MUC → FRA", "Hotel Borg", "Elbphilharmonie". */
  title: string;
  /** The second line: route, city, chain, cruise line. May be null. */
  subtitle: string | null;
  /** ISO day the entry is filed under, for sorting and for the date column. */
  date: string | null;
  /** Route to the entry, e.g. "/flights/abc". Null when it has no page. */
  href: string | null;
  /**
   * What this row contributes to `value`, in `metric.unit`. A flight
   * contributes 1 to a flight count and 954 to a km sum; a stay contributes
   * its nights. NEVER a fraction of a percentage — the panel explains the
   * number, it does not re-derive it.
   */
  contribution: number;
}

type UnattributedReason =
  /** A country known only from location history — no logbook entry to name. */
  | "transitOnly"
  /** The row that would prove it was deleted; the count is historical. */
  | "entryRemoved"
  /** The metric counts something the entry list cannot resolve per row. */
  | "notPerEntry";
```

### The keys have one home

`kind` and `key` are the only thing the tile and the endpoint share, so they are
defined once, in `shared/evidenceKeys.ts`, mirrored backend↔frontend like the
other shared vocabularies in this codebase:

```ts
export const EVIDENCE_METRICS = ["countries", "flights", "nights", "portCalls",
  "places", "distanceKm", "activeDays"] as const;
export type EvidenceMetric = (typeof EVIDENCE_METRICS)[number];

/** "airline:LH", "airport:MUC", "country:IS" — prefix names the dimension. */
export function rankingKey(dimension: RankingDimension, value: string): string;
export function parseRankingKey(key: string): { dimension; value } | null;
```

A tile that asks for a key the backend does not serve is then a type error, not
a 404 discovered by a user. Achievement keys are the achievement `code`, which
already exists and is already the identity used by `isLive()`; record keys are
the record ids from `services/stats/records.ts`.

The `year` query parameter applies to metrics, rankings and records — the three
things the statistics page filters. Achievements are lifetime by definition and
ignore it; the endpoint rejects `year` on an achievement key rather than
silently accepting a filter it does not apply.

### The rule that keeps the number and its evidence together

**The evidence endpoint never counts.** It resolves the SAME predicate the
number is built from and returns the rows that predicate selects:

- flights → `shared/flightCounting.countableFlightWhere`
- lodging → `shared/lodgingCounting`
- places → `shared/placeCounting`
- countries → `shared/countryEvidence`
- flight status/duration → `shared/statusDerivation`, `shared/flightDuration`

Where a number is computed inline inside a route handler today, the predicate is
**extracted first**, into the `shared/` module that owns that question. That
extraction is part of this work, not a side effect of it: an evidence list built
from a second, hand-written query is exactly the failure this project has had
twice ("Deutschland" and "Germany" counted as two countries; flight costs summed
across currencies), and the whole point of answering from the backend is to make
it structurally impossible.

### The test that fails without the rule

Per evidence kind, on real seeded data:

```ts
const sum = res.entries.reduce((n, e) => n + e.contribution, 0);
expect(sum + (res.unattributed?.count ?? 0)).toBe(res.metric.value);
```

When `truncated` is true the assertion runs against `total` instead of
`entries.length`, and a second case proves the cap does not change the sum.

This is the guard the feature exists for. A panel that disagrees with the tile
above it is worse than no panel, because it teaches the user that the numbers
are guesses.

## The four surfaces

### 1. Achievements

Every card opens its evidence.

- **Unlocked**: the entries that satisfied the requirement, oldest first, and
  the one that crossed the line marked as such (it carries the unlock date).
- **Not yet unlocked**: the entries that count so far, plus a line saying what
  is missing in the requirement's own unit ("noch 3 Flüge", not "70 %").
  Progress is already computed per achievement; the panel states the remainder
  rather than a percentage, because a percentage cannot be acted on.
- **Retired** (`isRetired`): the entries stay visible, with the note that the
  definition was withdrawn and the achievement counts only towards points.

### 2. Headline metrics

The tiles on the statistics overview and the per-domain summary cards:
countries, flights, nights, port calls, places, distance, active travel days.
The `year` filter of the page travels with the request unchanged, so the panel
answers for exactly the period on screen.

### 3. Rankings

Airlines, airports, countries, continents, aircraft types. The key identifies
the row (`airline:LH`, `airport:MUC`, `country:IS`), and the entries are the
rows of that group, which is what a ranking row IS — the evidence here is
simply the group's members, so the sum test is exact by construction.

### 4. Records and superlatives

Longest flight, most countries in a year, longest trip, most expensive trip,
biggest gap, and the rest of `services/stats/records.ts`.

A record has exactly one winning entry, so `entries` has length 1 and
`contribution` equals the record's value. What the panel adds here is the
**measurement**: the unit, the comparison used, and — where relevant — what was
NOT comparable.

#### The cross-currency defect this surfaces

"Teuerste Reise" currently ranks trips by the raw amount of their largest
currency bucket (`frontend/src/lib/stats/tripInsights.ts`,
`tripDominantCost` + `winner`). In the demo account that makes Japan the winner
with 334.000 ¥ against a 1.650 € trip — right by accident, since 334.000 ¥ is
about 2.030 €, but a 200.000 KRW trip (≈ 130 €) would beat every euro trip.

The panel would print that comparison, so the record is fixed in the same work:
ranking happens on the base-currency amount (`price_base`,
`total_price_base`, already on flights, bookings and stays), a trip whose cost
cannot be converted is **left out of the comparison** rather than compared on
its face value, and the panel names how many trips were left out and why. The
displayed value stays the money actually spent, in its own currency — the
conversion decides the ORDER, not the label.

## The panel

- Enters from the right on desktop, full-screen sheet below the `sm` breakpoint.
- Focus trap, Escape to close, focus returned to the tile — through the existing
  `useDialogChrome`, not a second implementation.
- **The open panel is in the URL**: `?evidence=<kind>:<key>` (plus the year that
  is already there). A link can be shared, the browser's back button closes it,
  and a reload reopens it. This is what the "own detail page" option would have
  bought, without a page change.
- Fetched on open, never with the page. A tile costs nothing until it is asked.
- Capped at 200 entries: beyond that `truncated` is true and the footer offers
  "im Logbuch mit diesem Filter zeigen", linking to the logbook with the
  matching filter rather than paginating a second table.
- Copy is German-first with the English mirror, in a new `evidence` namespace.

## What this does not need

- **No beta gate.** The goal for 2.7.0 is that the registry is empty; a feature
  that is finished does not enter it.
- **No demo guard.** Reading one's own evidence spends nothing and exposes
  nothing; the shared demo account may open the panels like anybody else.
- **No new tables.** Every row the panel names already exists.

## Risks, named

1. **The achievement checks may only count.** If `utils/achievementChecks.ts`
   computes progress without ever holding the contributing rows, every check
   needs an "and which rows" variant. That is the difference between one day
   and three, and it is the first thing the plan settles.
2. **Rankings computed in JS over a full load** (`/stats/routes`,
   `routes/achievements.ts` are named in CLAUDE.md as loading everything and
   slicing in JS) will need the same care as the SQL ones, or the panel becomes
   the second full load of the same data.
3. **The cap hides disagreement.** A truncated list whose sum is checked against
   `total` and not against the rows on screen could still drift. The second test
   case above exists for that.

## Success

- Every tile, card, ranking row and record on both pages opens a panel.
- For each, the sum test holds on the seeded demo account.
- Nothing that was visible before moved or changed, except the most-expensive
  record, which changed because it was wrong.
