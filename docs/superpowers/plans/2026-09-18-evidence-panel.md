# Evidence panel implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every number on the Achievements and Statistics pages opens a panel naming the entries that produced it, answered by the same predicate that produced the number.

**Architecture:** One endpoint (`GET /api/v1/evidence/:kind/:key`) with one response shape for four kinds. It never counts: it resolves the shared counting rule the number is built from and returns the rows that rule selects. A per-kind test asserts `sum(contribution) + unattributed.count === metric.value`. The frontend opens a panel built on the existing `components/Modal.tsx`, addressed by a `?evidence=<kind>:<key>` query parameter.

**Tech Stack:** Express/TypeScript + Prisma, React/Vite/TypeScript, Zustand, react-i18next, Jest/supertest (backend), Vitest + Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-09-18-evidence-panel-design.md`

## Measurements this plan is built on

Taken on 2026-09-18 against the branch, not estimated:

- **275 achievements, 150 requirement types.** 92 types carry exactly one achievement — a long tail, so a per-type implementation is out of the question.
- **By domain:** flight 109, lodging 75, poi 39, cruise 38, shared 14.
- **A name-based first pass** puts ~249 of 275 in "a filter over rows" and ~26 (streaks, shares, loyalty, `same_day_return`, `timezone_span`) in "derived across the set". That number is a heuristic and Task 3 replaces it with a verified one — its test forces every requirement type to be classified by hand.
- **`checkAchievement`** is one `switch` over `requirementType` reading a pre-aggregated `UserStats`; `achievementStats.ts` drops row ids while aggregating.
- **Two drill-downs already ship** and are the model: `GET /stats/countries/:code` (`buildCountryDetail`, rendered by `Passport/CountryProvenance.tsx`) and `GET /stats/aircraft/:registration`.

## Global Constraints

- **Code, comments, commit messages: English.** UI copy: German first, English mirrored in the same change — `frontend/src/i18n/__tests__/localeKeyParity.test.ts` fails otherwise.
- **The evidence endpoint never re-implements a count.** It calls the module that owns the rule: `shared/flightCounting.countableFlightWhere`, `shared/cruiseCounting`, `shared/lodgingCounting.classifyStay`, `shared/placeCounting`, `shared/countryEvidence`. Where a number is computed inline in a route, extract the predicate first, into the `shared/` module that owns the question.
- **Every behaviour change ships with a test that fails without it**, and the test names the defect.
- **No file over 800 lines** (`npm run check:size`); new files under `backend/src/routes/` must be assigned a family in `backend/src/__tests__/apiResponseShape.baseline.json` (evidence is `bare`).
- **Every served endpoint appears in the OpenAPI spec** and every documented 200 carries a JSON schema — `openapi.coverage.test.ts` and `openapi.responseSchema.test.ts`.
- **`/api` answers `no-store`** by default; evidence adds no cache header.
- **No beta gate.** The 2.7.0 goal is an empty registry.
- **Abstention is a result**: a number without per-entry evidence returns `unattributed` with a reason, never a fabricated row and never a silent zero.
- **Shared modules are mirrored** backend↔frontend with a "change both together" header, each side carrying its own test of the same truth table.

## File Structure

**New — backend**

| File | Responsibility |
|---|---|
| `backend/src/shared/evidence.ts` | The contract: `EvidenceKind`, `EvidenceEntry`, `EvidenceResponse`, `UnattributedReason`, `EVIDENCE_METRICS`, `rankingKey`/`parseRankingKey`. Types and pure key functions only. |
| `backend/src/services/evidence/index.ts` | `resolveEvidence(userId, kind, key, opts)` — the one entry point the route calls; dispatches to the four resolvers. |
| `backend/src/services/evidence/achievementEvidence.ts` | `EVIDENCE_BY_REQUIREMENT`: requirement type → row predicate over the arrays `runAchievementCheck` loads. |
| `backend/src/services/evidence/metricEvidence.ts` | The headline metrics. |
| `backend/src/services/evidence/rankingEvidence.ts` | Airlines, airports, countries, continents, aircraft types. |
| `backend/src/services/evidence/recordEvidence.ts` | The superlatives that are on screen. |
| `backend/src/services/evidence/entryMappers.ts` | Row → `EvidenceEntry` per domain (title, subtitle, date, href). One place, so a flight looks the same in every panel. |
| `backend/src/routes/evidence.ts` | The router: auth, validation, 404 on an unknown key. |

**New — frontend**

| File | Responsibility |
|---|---|
| `frontend/src/shared/evidence.ts` | Mirror of the backend contract module. |
| `frontend/src/components/evidence/EvidencePanel.tsx` | The panel: header with label + value, scrolling entry list, footer with the truncation link. |
| `frontend/src/components/evidence/EvidenceEntryRow.tsx` | One row: icon, title, subtitle, date, contribution, link. Generalises `Passport/CountryProvenance.tsx`'s `linkFor`/`labelFor`. |
| `frontend/src/components/evidence/useEvidence.ts` | Reads `?evidence=` , fetches on open, exposes `{ open, entry, close }`. |
| `frontend/src/lib/api/evidence.ts` | `evidenceApi.get(kind, key, params)`. |
| `frontend/src/i18n/resources/{de,en}/evidence.json` | The panel's copy. |

**Modified**

| File | Change |
|---|---|
| `backend/src/services/stats/summary.ts` | `id` added to the two `findMany` selects so the same rows can be named. |
| `backend/src/routes/stats.ts` | The `/countries` tile points at the passport engine instead of its own airport-country aggregation. |
| `backend/src/routes/trips.ts` | The trips list sends base-currency amounts (`priceBase`, `totalPriceBase`, `fxBaseCurrency`). |
| `frontend/src/lib/stats/tripInsights.ts` | Ranking on the base amount; trips that cannot convert leave the comparison. |
| `frontend/src/components/achievements/AchievementCard.tsx` | Becomes activatable (button semantics, keyboard). |
| `frontend/src/components/Stats/*` + `frontend/src/pages/AdvancedStatsPage.tsx` | Tiles and ranking rows become activatable. |
| `backend/src/services/openapi/paths/misc.ts` | The evidence path and its schema. |
| `backend/src/__tests__/apiResponseShape.baseline.json` | The new router files, family `bare`. |
| `CHANGELOG.md` — **not on this branch.** The country-count change is written up when the branch is released; `/deploy` owns that file. |

---

### Task 1: The contract and its keys

**Files:**
- Create: `backend/src/shared/evidence.ts`
- Create: `frontend/src/shared/evidence.ts`
- Test: `backend/src/shared/__tests__/evidence.test.ts`
- Test: `frontend/src/shared/__tests__/evidence.test.ts`

**Interfaces:**
- Produces: the types every later task consumes, and `rankingKey(dimension, value): string` / `parseRankingKey(key): { dimension, value } | null`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test** (`backend/src/shared/__tests__/evidence.test.ts`)

```ts
import { rankingKey, parseRankingKey, EVIDENCE_METRICS } from "../evidence";

/**
 * The key is the only thing a tile and the endpoint share. A tile that builds
 * it one way and a resolver that reads it another way is a 404 the user finds,
 * so the round trip is pinned here and the vocabulary is a closed list.
 */
describe("evidence keys", () => {
  it("round-trips every dimension", () => {
    for (const dimension of ["airline", "airport", "country", "continent", "aircraftType"] as const) {
      expect(parseRankingKey(rankingKey(dimension, "LH"))).toEqual({ dimension, value: "LH" });
    }
  });

  it("keeps a value containing a colon intact — an airline name may carry one", () => {
    expect(parseRankingKey(rankingKey("airline", "Air: One"))).toEqual({
      dimension: "airline",
      value: "Air: One",
    });
  });

  it("refuses a key with an unknown dimension rather than guessing", () => {
    expect(parseRankingKey("nonsense:LH")).toBeNull();
    expect(parseRankingKey("LH")).toBeNull();
  });

  it("lists the metrics the panel may ask for", () => {
    expect(EVIDENCE_METRICS).toContain("countries");
    expect(new Set(EVIDENCE_METRICS).size).toBe(EVIDENCE_METRICS.length);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest src/shared/__tests__/evidence.test.ts`
Expected: FAIL, "Cannot find module '../evidence'".

- [ ] **Step 3: Write the module**

```ts
/**
 * The evidence contract — what "which entries produced this number" answers
 * with, and the keys that name a number.
 *
 * MIRRORED at `frontend/src/shared/evidence.ts`; change both together. Each
 * side has its own test of the same truth table, which is the convention in
 * this codebase — nothing checks the mirror itself.
 */
export type EvidenceKind = "achievement" | "metric" | "ranking" | "record";

export const EVIDENCE_METRICS = [
  "countries", "flights", "nights", "portCalls", "places", "distanceKm", "activeDays",
] as const;
export type EvidenceMetric = (typeof EVIDENCE_METRICS)[number];

export const RANKING_DIMENSIONS = [
  "airline", "airport", "country", "continent", "aircraftType",
] as const;
export type RankingDimension = (typeof RANKING_DIMENSIONS)[number];

/** `airline:LH`. The FIRST colon separates; the value keeps any others. */
export function rankingKey(dimension: RankingDimension, value: string): string {
  return `${dimension}:${value}`;
}

export function parseRankingKey(key: string): { dimension: RankingDimension; value: string } | null {
  const at = key.indexOf(":");
  if (at <= 0) return null;
  const dimension = key.slice(0, at) as RankingDimension;
  if (!RANKING_DIMENSIONS.includes(dimension)) return null;
  const value = key.slice(at + 1);
  return value ? { dimension, value } : null;
}

export type UnattributedReason = "transitOnly" | "entryRemoved" | "notPerEntry";
export type EvidenceDomain = "flight" | "cruise" | "lodging" | "place" | "trip";

export interface EvidenceEntry {
  domain: EvidenceDomain;
  id: string;
  title: string;
  subtitle: string | null;
  date: string | null;
  href: string | null;
  /** What this row contributes to `metric.value`, in `metric.unit`. */
  contribution: number;
}

export interface EvidenceResponse {
  metric: { kind: EvidenceKind; key: string; label: string; value: number; unit: string };
  entries: EvidenceEntry[];
  total: number;
  truncated: boolean;
  unattributed?: { count: number; reason: UnattributedReason };
}

/** Beyond this the panel offers the logbook filter instead of a second table. */
export const EVIDENCE_ENTRY_CAP = 200;
```

- [ ] **Step 4: Run both tests to verify they pass**

Run: `cd backend && npx jest src/shared/__tests__/evidence.test.ts` and `cd frontend && npx vitest --run src/shared/__tests__/evidence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/shared/evidence.ts frontend/src/shared/evidence.ts \
        backend/src/shared/__tests__/evidence.test.ts frontend/src/shared/__tests__/evidence.test.ts
git commit -m "feat(evidence): the contract and the keys that name a number"
```

---

### Task 2: The endpoint, proven end to end on one ranking

The first kind wired is `ranking:airline`, because it is the hardest query shape (a SQL `groupBy` whose evidence needs a second, correctly-grouped query) and because getting it right proves the contract. Achievements — the biggest unknown — come after the stack stands.

**Files:**
- Create: `backend/src/routes/evidence.ts`, `backend/src/services/evidence/index.ts`, `backend/src/services/evidence/rankingEvidence.ts`, `backend/src/services/evidence/entryMappers.ts`
- Modify: `backend/src/routes/mounts.ts`, `backend/src/services/openapi/paths/misc.ts`, `backend/src/__tests__/apiResponseShape.baseline.json`
- Test: `backend/src/routes/__tests__/evidence.ranking.test.ts`

**Interfaces:**
- Consumes: Task 1's contract.
- Produces: `resolveEvidence(userId: string, kind: EvidenceKind, key: string, opts: { year?: number }): Promise<EvidenceResponse | null>` — `null` means "no such key", which the route turns into 404.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * The airline ranking is a Prisma `groupBy`, and `groupAirlines` folds spelling
 * variants ("Lufthansa", "Lufthansa AG", LH) into one row. Evidence built from
 * a hand-written `where` would therefore disagree with the row it explains —
 * the drift this whole feature exists to prevent. The sum test is the guard.
 */
it("names every flight behind an airline ranking row, and they add up", async () => {
  const ranking = await request(app).get("/api/v1/stats/airlines").set("Cookie", cookie);
  const top = ranking.body.airlines[0];

  const res = await request(app)
    .get(`/api/v1/evidence/ranking/${encodeURIComponent(`airline:${top.code ?? top.airline}`)}`)
    .set("Cookie", cookie);

  expect(res.status).toBe(200);
  expect(res.body.metric.value).toBe(top.count);
  const sum = res.body.entries.reduce((n: number, e: { contribution: number }) => n + e.contribution, 0);
  expect(sum + (res.body.unattributed?.count ?? 0)).toBe(res.body.metric.value);
  expect(res.body.entries.every((e: { href: string }) => e.href.startsWith("/flights/"))).toBe(true);
});

it("answers 404 for a key it does not serve, rather than an empty list", async () => {
  const res = await request(app).get("/api/v1/evidence/ranking/airline:ZZZZ").set("Cookie", cookie);
  expect(res.status).toBe(404);
});

it("refuses a year on an achievement key instead of ignoring it", async () => {
  const res = await request(app)
    .get("/api/v1/evidence/achievement/first_flight?year=2026")
    .set("Cookie", cookie);
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run it and watch it fail** — `Cannot GET /api/v1/evidence/...` (404 from Express, not from the handler).

- [ ] **Step 3: Write the entry mappers**

One place decides how a row reads in every panel:

```ts
export function flightEntry(f: FlightRow, contribution = 1): EvidenceEntry {
  return {
    domain: "flight",
    id: f.id,
    title: [f.airline, f.flightNumber].filter(Boolean).join(" ") || "—",
    subtitle: f.depIata && f.arrIata ? `${f.depIata} → ${f.arrIata}` : null,
    date: f.departureTime ? f.departureTime.toISOString().slice(0, 10) : null,
    href: `/flights/${f.id}`,
    contribution,
  };
}
```
plus `cruiseEntry`, `lodgingEntry`, `placeEntry`, `tripEntry` in the same shape.

- [ ] **Step 4: Write the ranking resolver for `airline`**

It reads the ranking the same way the ranking does — `groupAirlines` from `shared/airlineNormalize.ts` decides which codes and names belong to the row — then selects those flights with `countableFlightWhere()`.

- [ ] **Step 5: Write the route and mount it**

`router.get("/evidence/:kind/:key", authenticate, …)`, Zod-validated params, `year` accepted only for `metric`/`ranking`/`record`. Mount in `routes/mounts.ts` at `/api/v1`. Add both new route files to `apiResponseShape.baseline.json` under `bare`. Add the path to `services/openapi/paths/misc.ts` with a response schema.

- [ ] **Step 6: Run the tests** — all three pass; `npx jest src/__tests__/openapi` and `apiResponseShape` stay green.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(evidence): the endpoint, proven on the airline ranking"
```

---

### Task 3: Classify every requirement type — the honest coverage number

No user-visible change. This task produces the table the achievement panel needs and the test that keeps it complete.

**Files:**
- Create: `backend/src/services/evidence/achievementEvidence.ts`
- Test: `backend/src/services/evidence/__tests__/achievementEvidence.coverage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { achievements } from "../../../data/achievements";
import { EVIDENCE_BY_REQUIREMENT, NO_PER_ENTRY_EVIDENCE } from "../achievementEvidence";

/**
 * 275 achievements over 150 requirement types, 92 of them with a single
 * achievement. A type that is neither given a predicate nor explicitly listed
 * as having no per-entry evidence would open a panel that quietly shows
 * nothing — so the catalogue is the test's input and every type must be
 * decided by a person.
 */
it("classifies every requirement type in the catalogue", () => {
  const unclassified = [...new Set(achievements.map((a) => a.requirementType))].filter(
    (t) => !(t in EVIDENCE_BY_REQUIREMENT) && !NO_PER_ENTRY_EVIDENCE.has(t)
  );
  expect(unclassified).toEqual([]);
});

it("states its coverage, so a drop is visible in the diff", () => {
  const covered = achievements.filter((a) => a.requirementType in EVIDENCE_BY_REQUIREMENT);
  // Update this number when predicates are added — never downwards without a reason.
  expect(covered.length).toBeGreaterThanOrEqual(COVERAGE_FLOOR);
});
```

- [ ] **Step 2: Run it to see the full list of unclassified types** — this is the measurement; it prints all 150.

- [ ] **Step 3: Write the table**

Each predicate filters the arrays `runAchievementCheck` already loads. Shape:

```ts
export interface AchievementInputRows {
  flights: FlightRow[]; cruises: CruiseRow[]; stays: StayRow[]; places: PlaceRow[];
}
export type EvidencePredicate = (rows: AchievementInputRows, a: Achievement) => EvidenceEntry[];

export const EVIDENCE_BY_REQUIREMENT: Record<string, EvidencePredicate> = {
  flights_count: ({ flights }) => flights.filter(isCountableFlight).map((f) => flightEntry(f)),
  distance_km: ({ flights }) =>
    flights.filter(isCountableFlight).map((f) => flightEntry(f, Math.round(f.distanceKm ?? 0))),
  lodging_nights: ({ stays }) =>
    stays.filter((s) => classifyStay(s) === "visited").map((s) => lodgingEntry(s, s.nights ?? 0)),
  // …
};

/**
 * Types whose number is derived ACROSS the set rather than from rows: streaks,
 * shares, loyalty ratios, `same_day_return`, `timezone_span`. The panel says so
 * instead of listing an arbitrary subset.
 */
export const NO_PER_ENTRY_EVIDENCE = new Set<string>([ /* … */ ]);
```

- [ ] **Step 4: Run the test until the unclassified list is empty**, then record the real coverage in `COVERAGE_FLOOR` and in the module header.

- [ ] **Step 5: Commit** — the message states the measured coverage: how many of 275 have per-entry evidence and how many answer `notPerEntry`.

---

### Task 4: The panel

**Files:** `frontend/src/components/evidence/{EvidencePanel,EvidenceEntryRow,useEvidence}.tsx`, `frontend/src/lib/api/evidence.ts`, `frontend/src/i18n/resources/{de,en}/evidence.json`

The panel comes BEFORE the first surface that opens it. The first draft had it
the other way round, which would have shipped a card that sets a query
parameter nothing reads — a half-feature between two commits, and a reviewer
with nothing to look at.

- [ ] Test first (Vitest + Testing Library): opening sets `?evidence=achievement:<code>`; the panel shows the label and the value; entries link into the logbook; Escape closes and restores focus to the tile; a response with `unattributed` renders the reason, and one without renders no gap line.
- [ ] Built on `components/Modal.tsx` (fixed header, scrolling body, footer), docked right at `sm` and above. `useDialogChrome` provides the focus trap.
- [ ] Copy in `de` first, `en` mirrored in the same commit — `localeKeyParity` fails otherwise.
- [ ] Until a real surface is wired (Task 5), the panel is driven in tests only; nothing on screen opens it yet.
- [ ] Commit.

---

### Task 5: Achievements answer, and the cards open

**Files:** `backend/src/services/evidence/index.ts` (achievement branch), `frontend/src/components/achievements/AchievementCard.tsx`

- [ ] Test first: for every UNLOCKED achievement of the seeded demo account, `sum(contribution) + unattributed >= requirement`, and for a locked one the sum equals the stored `progress`. That second assertion is the one that catches a predicate disagreeing with `checkAchievement`.
- [ ] The card becomes a `<button>` with the card's own styling, `aria-haspopup="dialog"`, keyboard-activatable. A retired achievement opens too.
- [ ] Commit.

---

### Task 6: Headline metrics

- [ ] `services/stats/summary.ts`: add `id` to both selects. Test: the summary numbers are unchanged (a snapshot of the existing fields) — the select grew, nothing else.
- [ ] `metricEvidence.ts` for flights, distance, nights, port calls, places, active days, each through its shared counting rule, each with the sum test.
- [ ] Tiles in `StatsOverviewCards` and the per-domain summary cards become activatable; the page's `year` travels into the key.
- [ ] Commit.

---

### Task 7: The country tile stops counting twice

- [ ] Test first: `/stats/countries` returns the same count as the passport's `countCountries(evidence)` for the same user — today it does not, and the test names why (airport-country aggregation versus evidence across four domains).
- [ ] Point the tile at `loadPassport`, and the panel at `buildCountryDetail` unchanged.
- [ ] A country proved only by location history renders `unattributed: { reason: "transitOnly" }`.
- [ ] Commit, and note in the message that a visible number may move and belongs in the release notes.

---

### Task 8: The remaining rankings

- [ ] Airports, countries, continents, aircraft types. Airport rows already carry ids; the aircraft-type ranking is a `groupBy` and needs the second query, like airlines.
- [ ] Sum test per dimension.
- [ ] Ranking rows become activatable.
- [ ] Commit.

---

### Task 9: Records, and the cross-currency fix

- [ ] `backend/src/routes/trips.ts`: the trips list sends `priceBase` / `totalPriceBase` / `fxBaseCurrency` for flights, cruises, stays and bookings. Test: the payload carries them.
- [ ] `frontend/src/lib/stats/tripInsights.ts`: rank on the base amount; a trip with an unconvertible cost leaves the comparison. Test, failing today: a trip of 200.000 KRW does not beat a 1.650 € trip.
- [ ] The trip superlative panel reads the winning `Trip`'s own arrays — no round trip — and names how many trips were left out of the comparison and why.
- [ ] The unique/fun superlatives get their evidence from the rows `statsCalculator` already receives.
- [ ] Commit.

---

### Task 10: Verification and the record of it

- [ ] Full gates: `tsc`, lint, both suites, `check:size`, `check:drift`, `prettier --check` in CI view (`git -c core.autocrlf=false archive`).
- [ ] Browser verification against the seeded demo account on the local stack, at 1440 and 390: one achievement (unlocked and locked), one metric tile, one ranking row, one record, one `notPerEntry` case. The panel is a visual component and the airline-logo lesson applies — green tests are not a look.
- [ ] `design/DESIGN_SYSTEM.md` gains the panel; `docs/` gets nothing new (the spec is the record).
- [ ] Commit.
