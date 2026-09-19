# Evidence panel — which entries produced this number

**Status:** design approved 2026-09-18, then **substantially revised the same day**
after an independent review (Codex, read-only, against the code) refuted three of
its decisions. This document is the revision. The first version is in git; what
it got wrong is recorded here under "What the first version got wrong", because a
spec that quietly drops its own mistakes teaches nobody.

**Branch:** `dev/design-system`.

## The request

> "es fehlt die Detail seite bei den Erfolgen und statistiken für die jeweiligen
> einträge. Welche einträge haben den Erfolg oder Statistik ausgelößt usw"
> — owner, 2026-09-18

Every number on the Achievements and Statistics pages is a dead end. The user
sees "21 Länder", "124 von 275 Erfolgen", "Vielflieger: 10 Flüge" and cannot ask
which of their entries produced it.

## Owner decisions

| Question | Decision | When |
|---|---|---|
| How does the detail open? | A side panel, full-screen sheet on phones. Not a route, not an inline expander. | before design |
| Which surfaces? | Achievements, headline metrics, rankings, records. | before design |
| Where does evidence come from? | The backend, never a frontend re-filter. | before design |
| Numbers with no per-entry evidence? | Say so, with the reason. | before design |
| Branch? | `dev/design-system`. | before design |
| **Cruise base-currency columns?** | **Add them.** `Cruise` is the only priced model without them. | after the review |
| **Scope of the first release?** | **Rankings and metrics first; achievements second**, once provenance is collected inside the producers. | after the review |

## What the first version got wrong

Three decisions, each refuted with evidence from the code:

1. **"`sum(contribution) + unattributed === value` holds for all four kinds."**
   It does not. Ten flights prove ONE country; one international flight proves
   TWO (`achievementStats.ts` adds both endpoints to a `Set`). Rounding has to
   stay after aggregation — two contributions of 0.6 round to 2 individually and
   to 1 together. A truncated list is undefined as written, because `total`
   counts entries and not kilometres, and the omitted 201st row is KNOWN
   evidence rather than unattributed. And "a record has exactly one winning
   entry" is false: the longest layover is derived from TWO flights
   (`utils/stats/uniqueStats.ts`).
2. **"A table of row predicates keeps the evidence and the number together."**
   It would have been the drift it was meant to prevent. The draft's own example
   code read `f.distanceKm` (achievement flights carry no such field — distance
   is computed from coordinates) and `s.nights` (insufficient: the real path is
   `resolveStayTiming` → `walkNights`), and a "matching flights, contribution 1"
   predicate mis-implements `island_flights`, which credits both endpoints.
3. **"The statistics page counts countries a second time and should be pointed
   at the passport engine."** The separation is deliberate and says so in a
   comment above the endpoint — "These are LISTS, and they stay lists". Further,
   `/stats/hero` already uses `passport.summary.countries`, and the web overview
   already unions countries across the VISIBLE domains. Re-pointing the flight
   distribution would have attributed lodging and location-history countries to
   flights and broken the domain toggles.

The first version also missed four facts that change scope: `Cruise` has no
base-currency columns; `/trips` caps at 500 trips and 200 nested rows per domain;
the promised "show it in the logbook with this filter" escape hatch does not
exist; and a surface's population is not named by a year alone — the flight
overview is explicitly all-time, scorecards support `rolling12m`, and the
overview's countries depend on which domains are visible.

## Goal

One question — *which entries produced this number?* — answered by the same
computation that produced the number, for the numbers on those two pages, with
an invariant per **aggregation kind** rather than one invariant for everything.

## Non-goals

- Not an export, not a second table with its own filters.
- Not a redefinition of any number. One number changes — the most expensive trip
  — because it is wrong, and that change is a changelog entry.
- Not a permission boundary: evidence is the caller's own data, read-only.
- **Not the passport.** Its country provenance already exists and is the model
  this copies; it is not rebuilt.

## The model: aggregation kinds

A number is not just a number. What "evidence" means, and what may be asserted
about it, depends on how the number was aggregated:

| Aggregation | Example | What an entry is | Invariant |
|---|---|---|---|
| `sum` | total distance, nights | a row with a RAW, unrounded contribution | `round(Σ returned + Σ omitted + Σ unattributed[notPerEntry]) === value`, at the same rounding step the surface uses |
| `distinct` | countries, unique airports, active days | a row plus the **unit it witnesses** (`credits: string[]`) | `|distinct(credits ∪ omitted credits)| + unattributedUnits === value` |
| `extremum` | longest flight, longest layover | the **witnesses** — one row, or two for a layover | recomputing the measure over the witnesses reproduces `value` |
| `ratio` | an airline's share | the rows of the numerator, with the denominator stated | `numerator / denominator === value`, both returned |
| `boolean` | "has flown over an ocean" | the supporting rows | `value ∈ {0,1}` and, when 1, at least one row |
| `sequence` | longest streak | the ordered rows of the run | the run's length or span reproduces `value` |

`distinct` is the one the first version could not express, and it is the most
common shape on these two pages. A bare scalar per row cannot say that five
flights witness one country; `credits` can.

The `sum` row's term for `unattributed[notPerEntry]` was added on 2026-09-19
(task 7b-2). Without it the two rows disagreed for no stated reason, and the
consequence was concrete: `notPerEntry` — "derived across the set, no per-row
decomposition" — describes a `sum` and no `distinct` measure in the registry,
yet only `distinct` could report it. `travelAccountHomeNights` is the case
that found it: the nights away are subtracted from the year and the remainder
was slept at home, so the figure is derived and no row will ever name it. The
alternative was `value: null`, which would have claimed a derivable number
could not be derived.

**`notPerEntry` ALONE closes a `sum`'s gap** — the term is narrow on purpose,
and was narrowed in review after landing wide. The other two reasons count
ROWS rather than units of the measure: `entryRemoved` says a row is gone,
`locationHistoryOnly` that a country was proved by a track. Letting either
settle the arithmetic would let "three flights were deleted" pay for three
missing kilometres — a wrong total hidden behind a true sentence. They are
reported and not counted. `distinct` needs no such distinction, because there
every unattributed bucket already counts UNITS.

## The contract

```
GET /api/v1/evidence/:kind/:key
    kind ∈ "metric" | "ranking"                   release 1
           "record" | "achievement"               release 2 — answered 501
    body: EvidenceResponse
```

```ts
/**
 * `achievement` is declared here but served only in release 2. It is in the
 * union from the start so the panel, the key parser and the OpenAPI schema do
 * not change shape when it arrives — the endpoint answers 501 for it until then,
 * which is a different thing from 404 and says so.
 */
type EvidenceKind = "metric" | "ranking" | "record" | "achievement";

type EvidenceDomain = "flight" | "cruise" | "lodging" | "place" | "trip";

interface EvidenceScope {
  /** What population the number was measured over. Mirrors the surface. */
  period: { kind: "allTime" } | { kind: "year"; year: number } | { kind: "rolling12m" };
  /** Only where the surface is domain-filtered (the overview is). */
  domains?: EvidenceDomain[];
}

interface EvidenceMeasure {
  kind: EvidenceKind;
  key: string;
  aggregation: Aggregation;
  /** i18n KEY plus values — never a server-localised string. */
  label: { key: string; values?: Record<string, string | number> };
  unit: string;
  /** `null` when the measure cannot be derived — NOT the same as 0. */
  value: number | null;
  scope: EvidenceScope;
  /** `ratio` only: both sides, so the percentage can be explained. */
  numerator?: number;
  denominator?: number;
}

interface EvidenceEntry {
  domain: EvidenceDomain;
  /** Identity of the EVIDENCE — a stay id, a port call id. */
  id: string;
  /** Where the user goes. A stay's target is its lodging; may differ from id. */
  href: string | null;
  title: { key: string; values?: Record<string, string | number> } | { text: string };
  subtitle: { key: string; values?: Record<string, string | number> } | { text: string } | null;
  /** The surface's own clock rule, with its precision kept. */
  date: { value: string; precision: "day" | "month" | "year" } | null;
  /** `sum` only, RAW and unrounded. */
  contribution?: number;
  /** `distinct` only: the units this row witnesses ("DE", "MUC", "2026-04-02"). */
  credits?: string[];
}

interface EvidenceResponse {
  measure: EvidenceMeasure;
  entries: EvidenceEntry[];
  /** Three buckets, never two. */
  returned: number;
  /**
   * Known evidence NOT in `entries` — on any other page, before this one or
   * after it. "Beyond the page" was the first wording and it was wrong: the
   * invariant has to hold on EVERY page, and on page three the rows of pages
   * one and two are just as known and just as absent. This is evidence the
   * caller can reach by paging, which is what separates it from
   * `unattributed` — rows that do not exist to be reached.
   */
  omitted: { count: number; contribution?: number; credits?: number };
  /** Genuinely without a nameable row. Several reasons may coexist. */
  unattributed: Array<{ count: number; reason: UnattributedReason }>;
  page: { offset: number; limit: number };
}

type Aggregation = "sum" | "distinct" | "extremum" | "ratio" | "boolean" | "sequence";

/**
 * Why a unit of the number has no row to name. A LIST of these is returned, not
 * one: a country count can be short a row for two different reasons at once.
 */
type UnattributedReason =
  /**
   * Proved by stored location history (`CountryDay`) rather than by a logbook
   * entry. NOT called `transitOnly`: `trackEvidence.ts` can classify a tracked
   * country as `slept` or `visited`, so naming it "transit" would state
   * something the engine did not decide.
   */
  | "locationHistoryOnly"
  /** The row that proved it is gone; the number is historical. */
  | "entryRemoved"
  /** The measure is derived across the set and has no per-row decomposition. */
  | "notPerEntry";
```

Three changes from the first version, each forced by the review: the label is an
i18n key rather than a server-rendered string (the rest of this codebase
translates client-side, see `Passport/CountryProvenance.tsx`); the date keeps its
precision instead of being flattened with `toISOString().slice(0, 10)`, which is
not even the filed day (`summary.ts` files a flight by the departure airport's
local clock); and `unattributed` is a LIST, because a number can miss rows for
more than one reason at once.

### Paging, not a promise

The first version capped at 200 and offered "show it in the logbook with this
filter". That filter does not exist. Evidence pages instead: `offset`/`limit`,
default 100, and the panel loads more on scroll.

Sorting is stable and stated, because a page boundary that reorders drops or
repeats rows: **date descending, then id ascending**, with **undated rows last**
rather than sorted as epoch zero — a stay whose dates are unknown is not a stay
from 1970, and putting it first would be the same lie `shared/lodgingTiming.ts`
already refuses elsewhere. The sort is applied before the slice, and a test
pages through a fixture of 250 rows asserting that the concatenated pages equal
the unpaged list exactly.

### Four answers that are not the same answer

The endpoint distinguishes cases the first version collapsed:

| Situation | Answer |
|---|---|
| The key names nothing this instance serves (`airline:ZZZZ`, an unknown metric) | **404**. A key the frontend cannot build is a bug in the frontend, and an empty 200 would hide it. |
| The key is valid and the user has nothing — no flights on that airline | **200**, `measure.value: 0`, no entries. Zero is a true answer here. |
| The measure cannot be derived at all — no data to decide it | **200**, `measure.value: null`, entries empty, `unattributed` naming why. Abstention is a result: a derivable zero and an underivable value are different, and the panel must not print "0" for the second. |
| The user asks for another user's row | **404**, never 403. A 403 confirms the row exists. |

`measure.value` is therefore `number | null`, and every invariant in the table
above is asserted only when it is a number.

### The number may have moved since the tile rendered

A tile is drawn from one response and the panel from another, so the data can
change in between — an import finishing, another tab editing a flight. The panel
**repeats the value it measured** rather than trusting the tile's, so a
disagreement is visible instead of silent. When the two differ the panel says the
figure was recomputed; it never reconciles them behind the reader's back.

### Identity

A ranking row is addressed by the **canonical group key** the ranking itself
uses, exposed by the ranking endpoint for the purpose — not reconstructed from a
display label. For airlines that is `airlineGroupKey`'s result (stored IATA →
resolved ICAO → resolved name → normalised fallback), so a flight with
`airline: null` but `airlineIata: "LH"` lands in the row it was counted in.
Aircraft types are grouped RAW by the ranking, so evidence groups raw too;
applying the achievement-side `normalizeAircraft` would merge groups the ranking
keeps apart.

Every resolver preserves `countableFlightWhere()` and the ranking's own
denominator rule: airline percentages exclude unattributed flights, aircraft-type
percentages divide by all countable flights.

**An entry's identity is not always its destination.** A lodging STAY proves a
night; the page the user wants is the lodging (`/lodging/:lodgingId`), so `id`
and `href` name different rows and the response says both. A country can be
proved by a lodging that has no stay at all, which is an entry with a lodging id
and no date. Two port calls of one cruise are two pieces of evidence that share
one `href` — so `id` is the port-call id, and a panel that de-duplicated by
`href` would lose one. Tests cover all three, because each of them is a row the
naive implementation drops or merges.

### One schema, not two shapes

The response is defined ONCE, as the OpenAPI response schema, and the backend's
TypeScript types are derived from it — the lesson `backend/src/schemas/statsAircraft.ts`
already records. A hand-maintained interface beside a hand-maintained schema is
two descriptions of one payload, and they drift the first time a field is added.

## Release 1 — rankings and metrics

**Rankings**: airlines, airports, countries (the flight distribution, with its
own flight-domain semantics — the tile is NOT re-pointed), continents, aircraft
types. Airport rankings count endpoint occurrences, so a flight can credit two
airports and `distinct` is the wrong aggregation there — it is a `sum` over
endpoints, and the entry says which endpoint it credits.

**Metrics**: the tiles whose aggregation is `sum` or `distinct` over one domain,
each answered through its shared counting rule. The seven keys of the first
version were an under-count; the surface inventory (first task of the plan)
lists every number, its calculator, its scope and its aggregation, and that
inventory decides the key list rather than a guess.

**Performance.** A panel must not re-run `runAchievementCheck`, which loads
countable flights AND all flights, cruises with nested trip rows, stays,
lodgings, memberships, trips, settings and places, then calls `loadPassport` over
much of it again — the existing manual recheck is rate-limited precisely because
it scans the whole logbook. Each resolver declares the projection it needs and
loads that; display fields are batch-loaded for the returned page only. A GET
never calls `checkAndUpdateAchievements`, which writes.

Records go with achievements into release 2, for the same reason: the
superlatives on screen are `extremum` and `sequence` measures whose witnesses
come out of `utils/statsCalculator.ts` and `uniqueStats.ts`, which — like the
achievement producers — return derived values without the rows behind them. The
one thing that does NOT wait is the cross-currency defect in the most expensive
trip: that is a wrong number today, it is fixed in release 1, and its evidence
panel follows in release 2.

## Release 2 — achievements and records

Not in release 1, and the reason is the measurement: `checkAchievement` is one
~146-case switch over pre-aggregated statistics, and the producers
(`calculateUserStats`, `calculateCruiseStats`, `calculateLodgingStats`,
`calculatePlaceStats`) discard row identity while aggregating.

The approach is **provenance collected inside those producers**, at the exact
line where the aggregate moves — beside `stats.airports.add(depCode)`, beside
`stats.totalDistance += distance` — and not a second set of predicates beside
them. That keeps the decision and its evidence in one place, which is the whole
point; it also means the work touches the code 275 achievements depend on, which
is why it is its own release with its own review.

Two things release 2 must settle and release 1 need not:
- **The unlock date is not a row's date.** `unlockedAt` is `new Date()` at write
  time and can be triggered by an import or an edit. So the panel promises
  CURRENT supporting evidence, not a historical reconstruction of the moment.
- **A hidden locked achievement must stay hidden.** Opening its evidence would
  reveal the name and description the card deliberately conceals.

## The most expensive trip

`tripInsights.tripDominantCost` picks the largest per-currency bucket and
`winner` then compares those numbers across currencies: 334.000 ¥ beats 1.650 €,
and a 200.000 KRW trip (≈ 130 €) would beat every euro trip.

The fix, with the owner's decision of 2026-09-18:

- **`Cruise` gains `price_base`, `fx_rate`, `fx_rate_date`, `fx_base_currency`**,
  by migration, exactly as `Flight`, `Booking` and `LodgingStay` carry them. It
  is the only priced model without them, which is a defect in its own right.
- Ranking happens on the base amount. A trip that cannot be converted leaves the
  comparison and the panel says how many did and why.
- The displayed value stays the money actually spent, in its own currency. The
  conversion decides the ORDER, not the label.
- The trip superlatives are NOT computed from the already-loaded `Trip` objects:
  `/trips` caps at 500 trips and 200 nested rows per domain, so those arrays
  cannot guarantee the winner. The superlative and its evidence come from the
  backend like everything else.

## The panel

No drawer component exists. `components/ui/Dialog.tsx` is for a short question;
`components/Modal.tsx` has the fixed header, scrolling body and footer a list
needs, so the panel is built on `Modal`, widened and docked right at `sm` and
above, sheet below. `useDialogChrome` provides the focus trap and Escape.

The open panel is in the URL — `?evidence=<kind>:<key>` — so it is linkable and
the back button closes it. Copy is German-first with the English mirror, in a new
`evidence` namespace; entry titles are composed client-side from keys and values.

## What this does not need

No beta gate (2.7.0's goal is an empty registry). No demo guard: evidence is the
caller's own data and spends nothing. No new tables — except the four columns on
`Cruise`, which exist everywhere else already.

## Success

- Every ranking row and every inventoried metric tile opens a panel.
- Per aggregation kind, the invariant holds on the seeded demo account AND on
  fixtures built for the awkward cases: a distinct count with a row crediting two
  units, a sum whose per-row rounding would disagree, a truncated page, a ratio,
  and a two-witness extremum.
- Cross-user probes prove every resolver scopes by user, including nested rows.
- Nothing visible moves, except the most expensive trip.
