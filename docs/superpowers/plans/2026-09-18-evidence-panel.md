# Evidence panel — release 1 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every ranking row and every inventoried metric tile on the Statistics page opens a panel naming the entries that produced it, with an invariant asserted per aggregation kind.

**Architecture:** One endpoint, `GET /api/v1/evidence/:kind/:key`, whose payload is defined once as an OpenAPI response schema and whose backend types are derived from it. Release 1 serves `metric` and `ranking`; `record` and `achievement` are in the union and answer 501. Each resolver declares the projection it needs, preserves the surface's own counting rule and denominator, and returns three buckets — returned, omitted, unattributed.

**Tech Stack:** Express/TypeScript + Prisma, React/Vite/TypeScript, Zustand, react-i18next, Jest/supertest, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-18-evidence-panel-design.md` (revised 2026-09-18 after an independent review; read the "What the first version got wrong" section before changing anything here).

## This plan replaces an earlier one

The first cut was written against the spec's first version and is void. What it
got wrong is recorded in the spec and in
`.superpowers/sdd/2026-09-18-evidence-panel/progress.md`. Two of its artefacts
survive and are inputs here:

- **Commit `ee83027d`** created `backend/src/shared/evidence.ts` and its frontend
  mirror against the OLD contract. Task 2 rewrites both; it does not start from
  nothing, and it must not leave the old names behind.
- **The task review of that commit** found that `parseRankingKey` handles
  adversarial input correctly but that none of those cases are pinned by a test.
  Task 2 folds them in.

## Global Constraints

- **Code, comments, commit messages: English.** UI copy German-first with the English mirror in the same change (`localeKeyParity`).
- **A resolver never re-counts.** It uses the surface's own rule — `shared/flightCounting.countableFlightWhere`, `shared/airlineNormalize.airlineGroupKey`, `shared/lodgingCounting.classifyStay`, `shared/placeCounting`, `shared/countryEvidence` — and the surface's own denominator.
- **Rounding stays after aggregation.** Contributions are raw; the response rounds where the surface rounds.
- **Abstention is a result.** `measure.value` is `number | null`; a derivable zero and an underivable value are different answers.
- **A GET never writes.** `checkAndUpdateAchievements` is never called from this endpoint.
- **Every behaviour change ships with a test that fails without it**, named after the defect.
- **No file over 800 lines**; new files under `backend/src/routes/` get a family in `apiResponseShape.baseline.json` (evidence is `bare`).
- **Every served endpoint is in the OpenAPI spec with a response schema** — and here the schema is the SOURCE, not a copy.
- **`/api` answers `no-store`.** No beta gate. No demo guard.

## File Structure

**New — backend**

| File | Responsibility |
|---|---|
| `backend/src/shared/evidence.ts` | The contract: kinds, domains, aggregations, scope, entry, response, `UnattributedReason`, key builders/parsers. Types and pure functions only. |
| `backend/src/shared/evidenceMeasures.ts` | The registry: every measure key with its aggregation, unit, scope kind and owning surface. The inventory, in code. |
| `backend/src/schemas/evidence.ts` | The Zod/OpenAPI response schema — the single source the types are derived from. |
| `backend/src/services/evidence/index.ts` | `resolveEvidence(userId, kind, key, scope, page)`; dispatch, 501 for unserved kinds. |
| `backend/src/services/evidence/paging.ts` | Stable sort (date desc, id asc, undated last) and the slice. Used by every resolver. |
| `backend/src/services/evidence/rankingEvidence.ts` | Airlines, airports, countries, continents, aircraft types. |
| `backend/src/services/evidence/metricEvidence.ts` | The registry's metric keys. |
| `backend/src/services/evidence/entryMappers.ts` | Row → `EvidenceEntry` per domain, including the id-vs-href split. |
| `backend/src/routes/evidence.ts` | Auth, param validation, the four answers. |
| `backend/src/services/evidence/__tests__/invariants.ts` | The shared assertion helper, one per aggregation kind. |

**New — frontend**

| File | Responsibility |
|---|---|
| `frontend/src/shared/evidence.ts`, `frontend/src/shared/evidenceMeasures.ts` | Mirrors. |
| `frontend/src/components/evidence/EvidencePanel.tsx` | Header (label, value, scope), scrolling list, "load more", the three-bucket footer. |
| `frontend/src/components/evidence/EvidenceEntryRow.tsx` | One row, composing its title from keys and values. |
| `frontend/src/components/evidence/useEvidence.ts` | `?evidence=` state, fetch, paging. |
| `frontend/src/lib/api/evidence.ts` | The client. |
| `frontend/src/i18n/resources/{de,en}/evidence.json` | Copy. |

**Modified**

| File | Change |
|---|---|
| `backend/prisma/schema.prisma` + a migration | `Cruise` gains `price_base`, `fx_rate`, `fx_rate_date`, `fx_base_currency`. |
| `backend/src/routes/stats.ts`, `backend/src/routes/stats/aircraft.ts` | Ranking responses expose the canonical group key. |
| `frontend/src/lib/stats/tripInsights.ts` | Rank on the base amount; unconvertible trips leave the comparison. |
| `frontend/src/components/Stats/*`, `frontend/src/pages/AdvancedStatsPage.tsx` | Rows and tiles become activatable. |

---

### Task 1: The surface inventory, as a registry

No user-visible change. This decides the scope of release 1 and replaces the
seven metric keys the first plan guessed at — a guess the review showed was an
under-count (visible flight time, average duration, airline count, costs,
planned counts and achievement points were all missing).

**Files:**
- Create: `docs/superpowers/specs/2026-09-18-evidence-surface-inventory.md`
- Create: `backend/src/shared/evidenceMeasures.ts`, `frontend/src/shared/evidenceMeasures.ts`
- Test: `backend/src/shared/__tests__/evidenceMeasures.test.ts`

**Interfaces:**
- Produces: `EVIDENCE_MEASURES: Record<string, MeasureSpec>` where `MeasureSpec = { aggregation, unit, scope: "allTime"|"year"|"rolling12m"|"domainFiltered", surface: string, calculator: string, servedIn: 1 | 2 }`.

- [ ] **Step 1: Walk the two pages and write the inventory document.** One row per number a user can see, with: the component that renders it, the backend calculator that produces it, the scope it is measured over, its aggregation kind, and whether per-entry evidence is possible. Start from `frontend/src/pages/AdvancedStatsPage.tsx` and every component under `frontend/src/components/Stats/`, plus `frontend/src/pages/AchievementsPage.tsx`. The document is the record of what was looked at; the registry is what the code reads.

- [ ] **Step 2: Write the failing test**

```ts
import { EVIDENCE_MEASURES } from "../evidenceMeasures";

/**
 * The registry is the inventory in code. Two ways it goes stale, both caught
 * here: a measure whose spec is incomplete, and a key the panel can build but
 * no resolver serves. The first plan's seven hand-picked keys missed at least
 * six numbers that are on screen, which is why the list is derived from a walk
 * of the pages and not from memory.
 */
it("gives every measure a complete spec", () => {
  for (const [key, spec] of Object.entries(EVIDENCE_MEASURES)) {
    expect(spec.aggregation).toBeDefined();
    expect(spec.unit).toBeTruthy();
    expect(spec.surface).toBeTruthy();
    expect(spec.calculator).toBeTruthy();
    expect([1, 2]).toContain(spec.servedIn);
  }
});

it("serves at least one measure of each aggregation kind in release 1", () => {
  const kinds = new Set(
    Object.values(EVIDENCE_MEASURES).filter((s) => s.servedIn === 1).map((s) => s.aggregation)
  );
  expect(kinds).toContain("sum");
  expect(kinds).toContain("distinct");
});
```

- [ ] **Step 3: Run it and watch it fail** — the module does not exist.
- [ ] **Step 4: Write both copies of the registry from the inventory.**
- [ ] **Step 5: Run both suites; `tsc` and lint clean.**
- [ ] **Step 6: Commit.** The message states how many numbers the walk found and how many release 1 serves.

---

### Task 2: The contract, rewritten

**Files:**
- Modify: `backend/src/shared/evidence.ts`, `frontend/src/shared/evidence.ts` (both exist from `ee83027d` against the OLD contract)
- Modify: `backend/src/shared/__tests__/evidence.test.ts`, `frontend/src/shared/__tests__/evidence.test.ts`

**Interfaces:**
- Produces: `EvidenceKind`, `EvidenceDomain`, `Aggregation`, `UnattributedReason`, `EvidenceScope`, `EvidenceMeasure`, `EvidenceEntry`, `EvidenceResponse`, `rankingKey`, `parseRankingKey`, `EVIDENCE_PAGE_SIZE`.
- Removed: `EVIDENCE_METRICS` (the registry replaces it), `EVIDENCE_ENTRY_CAP` (paging replaces it).

- [ ] **Step 1: Write the failing tests.** Keep the existing round-trip cases and ADD the adversarial ones the task review named — they behave correctly today but nothing pins them:

```ts
it.each([["", "empty"], [":", "separator only"], ["airline:", "empty value"],
        [":LH", "empty dimension"], ["air:LH", "a prefix of a real dimension"]])(
  "refuses %s (%s) rather than guessing", (key) => {
    expect(parseRankingKey(key)).toBeNull();
  }
);

it("keeps every colon after the first inside the value", () => {
  expect(parseRankingKey("airline:A:B:C")).toEqual({ dimension: "airline", value: "A:B:C" });
});
```

- [ ] **Step 2: Run them; the adversarial cases pass (the implementation is already right), the new type tests fail to compile.**
- [ ] **Step 3: Rewrite both copies to the spec's contract.** `measure.value` is `number | null`. `unattributed` is an array. `omitted` is its own bucket. Labels and titles are `{ key, values }`. Dates carry precision.
- [ ] **Step 4: Verify the mirrors are identical** except the pointer comment — `diff` them; nothing checks this automatically.
- [ ] **Step 5: Run both suites, `tsc`, lint.**
- [ ] **Step 6: Commit.**

---

### Task 3: The endpoint, schema-first, with the four answers

**Files:**
- Create: `backend/src/schemas/evidence.ts`, `backend/src/routes/evidence.ts`, `backend/src/services/evidence/index.ts`, `backend/src/services/evidence/paging.ts`
- Modify: `backend/src/routes/mounts.ts`, `backend/src/services/openapi/paths/misc.ts`, `backend/src/__tests__/apiResponseShape.baseline.json`
- Test: `backend/src/routes/__tests__/evidence.contract.test.ts`

- [ ] **Step 1: Write the failing test** — the four answers, the unserved kinds, and paging:

```ts
it("answers 404 for a key it does not serve", async () => { /* → 404 */ });
it("answers 0 with no entries when the user simply has none", async () => { /* value 0, entries [] */ });
it("answers null, not 0, when the measure cannot be derived", async () => { /* value null + unattributed */ });
it("answers 404 for another user's row, never 403", async () => { /* a 403 confirms it exists */ });
it("answers 501 for a kind release 1 does not serve", async () => { /* record, achievement */ });

/**
 * A page boundary that reorders drops or repeats rows. 250 fixture rows, paged
 * at 100, must concatenate to exactly the unpaged list — and an undated row
 * sorts LAST, not as epoch zero, which is the same lie shared/lodgingTiming.ts
 * refuses elsewhere.
 */
it("pages a 250-row measure without dropping or repeating a row", async () => { /* … */ });
it("sorts undated rows last", async () => { /* … */ });
```

- [ ] **Step 2: Run it; every case fails with Express's own 404.**
- [ ] **Step 3: Write the response schema in `schemas/evidence.ts` and derive the TypeScript types from it** (`z.infer`), the way `schemas/statsAircraft.ts` does. The shared contract module states the shape; the schema is what the route validates against and what OpenAPI serves.
- [ ] **Step 4: Write `paging.ts`** — `sortEntries(entries)` then `sliceEntries(entries, { offset, limit })`, with the tie-breaker and undated-last rule, and unit tests of its own.
- [ ] **Step 5: Write the route and the dispatcher.** Every resolver receives `userId` and scopes every query by it.
- [ ] **Step 6: Mount, add the OpenAPI path, add the route files to the response-shape baseline as `bare`.**
- [ ] **Step 7: Run the suite plus `openapi.coverage`, `openapi.responseSchema`, `apiResponseShape`.**
- [ ] **Step 8: Commit.**

---

### Task 4: The invariant harness and its awkward fixtures

No production code. This is the guard every later task uses, and it is written
before the first real resolver so that no resolver can be written to fit a weak
assertion.

**Files:**
- Create: `backend/src/services/evidence/__tests__/invariants.ts`
- Create: `backend/src/services/evidence/__tests__/invariants.test.ts`

- [ ] **Step 1: Write the helper.** One exported assertion per aggregation kind:

```ts
/** `sum`: raw contributions, rounded ONCE at the end, like the surface. */
export function assertSumInvariant(res: EvidenceResponse, round: (n: number) => number): void;

/** `distinct`: the union of credited units, not the count of rows. */
export function assertDistinctInvariant(res: EvidenceResponse): void;

/** `extremum`: recomputing over the witnesses reproduces the value. */
export function assertExtremumInvariant(res: EvidenceResponse, measure: (e: EvidenceEntry[]) => number): void;

export function assertRatioInvariant(res: EvidenceResponse): void;
```

- [ ] **Step 2: Write fixtures that would pass a naive implementation and must fail these assertions**, one per trap the review named:
  - a `distinct` measure where ONE row credits two units (an international flight proving two countries) — a summing assertion would report 2 where the value is 2 but for the wrong reason, so the fixture also includes five rows crediting ONE shared unit, where a sum says 5 and the truth is 1;
  - a `sum` measure of two 0.6 contributions, where per-row rounding gives 2 and correct rounding gives 1;
  - a paged response whose omitted bucket carries contribution, proving `omitted` is not folded into `unattributed`;
  - a `ratio` whose numerator and denominator are both required;
  - an `extremum` with TWO witnesses (a layover).
- [ ] **Step 3: Assert the helpers FAIL on the wrong shapes and pass on the right ones** — a guard that cannot fail is not a guard.
- [ ] **Step 4: Commit.**

---

### Task 5: The airline ranking

The hardest identity in the feature, and the reason it goes first among the
resolvers.

**Files:** `backend/src/services/evidence/rankingEvidence.ts`, `backend/src/services/evidence/entryMappers.ts`, `backend/src/routes/stats.ts` (expose the canonical key)
**Test:** `backend/src/routes/__tests__/evidence.rankingAirline.test.ts`

- [ ] **Step 1: Write the failing tests**, each naming a way the naive version is wrong:
  - a flight with `airline: null` but `airlineIata: "LH"` appears in Lufthansa's evidence, because `airlineGroupKey` puts it in that ranking row;
  - only an identity resolving to `null` appears in `withoutAirline`;
  - a flight excluded by `countableFlightWhere()` appears in neither;
  - the sum invariant holds against the ranking row's own count;
  - the percentage's denominator excludes unattributed flights, as the ranking does.
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Expose the canonical group key from `/stats/airlines`** — the route returns `iata` and drops `g.key` today, so a panel would have to reconstruct identity from a display label whose spelling can change.
- [ ] **Step 4: Implement the resolver** by loading the countable identity projection, applying `airlineGroupKey`, and hydrating display fields for the returned page only.
- [ ] **Step 5: Run the tests and the harness.**
- [ ] **Step 6: Commit.**

---

### Task 6: The remaining rankings

- [ ] **Airports are a `sum` over endpoint occurrences, not a `distinct`** — `airportStats.ts` bumps both `dep` and `arr`, so one round trip credits the same airport twice, and the entry says which endpoint it credits. A test pins exactly that flight.
- [ ] **Aircraft types group RAW**, as the ranking does; applying `normalizeAircraft` would merge groups the ranking keeps apart. A test pins two spellings staying apart.
- [ ] Countries (the flight distribution, with its flight-domain semantics — the tile is NOT re-pointed at the passport) and continents.
- [ ] Each with its harness assertion.
- [ ] Commit.

---

### Task 7: The metrics

- [ ] Every registry entry with `servedIn: 1`, each through its shared counting rule, each declaring the projection it loads rather than reusing a whole-logbook load.
- [ ] `services/stats/summary.ts` returns the identities it already loads, rather than only `SummaryStats` — adding `id` to the select is not enough, because the rows never leave the function today.
- [ ] Scope travels as the structured object: a tile that is all-time asks for all-time even when the page has a year selected.
- [ ] Commit.

---

### Task 8: The panel

- [ ] Test first: the URL parameter drives it; the header shows the label composed from its key and the value; entries link to their `href` and not to their `id`; "load more" appends the next page; the three buckets render distinctly (returned / omitted / unattributed with its reason); a `null` value renders the abstention line and not "0"; Escape closes and returns focus.
- [ ] Built on `components/Modal.tsx`, docked right at `sm` and above.
- [ ] `de` and `en` in the same commit.
- [ ] Commit.

---

### Task 9: Wire the surfaces

- [ ] Ranking rows and inventoried tiles become activatable (button semantics, keyboard, `aria-haspopup="dialog"`).
- [ ] The panel repeats the value it measured; when it disagrees with the tile, it says the figure was recomputed.
- [ ] Commit.

---

### Task 10: Cruise base currency, and the most expensive trip

Independent of the panel: it fixes a wrong number that is live today.

- [ ] `npx prisma migrate dev` adds `price_base`, `fx_rate`, `fx_rate_date`, `fx_base_currency` to `Cruise`; `npm run check:drift` stays green.
- [ ] The write paths that set those columns for flights and stays set them for cruises, and a backfill is NOT attempted for historical rows — an invented rate is worse than an absent one.
- [ ] `tripInsights.ts` ranks on the base amount; a trip that cannot be converted leaves the comparison; the displayed value stays the money spent in its own currency. Test, failing today: a 200.000 KRW trip does not beat a 1.650 € trip.
- [ ] The trip superlatives are computed from a backend measure, not from the capped `/trips` payload.
- [ ] Commit.

---

### Task 11: Verification

- [ ] Full gates: `tsc`, lint, both suites, `check:size`, `check:drift`, `check:coverage`, `prettier --check` in CI view (`git -c core.autocrlf=false archive`).
- [ ] Browser verification on the seeded demo account at 1440 and 390: one ranking row, one `sum` tile, one `distinct` tile, a paged measure past 100 rows, and an abstention case. The airline-logo lesson applies — green tests are not a look.
- [ ] `design/DESIGN_SYSTEM.md` gains the panel.
- [ ] Commit.

---

### Task 12: the year comparison stops measuring unequal periods

Independent of the evidence panel and of everything above it — it is on this
plan only because the owner raised it here ("design du das", 2026-09-18) and it
is the same page. It may be implemented before or after any other task.

**The defect.** The statistics page compares the selected year against the one
before it. For the CURRENT year that is eight months against twelve: the demo
account shows "-29 Erlebnisse (-78 %)" in September, which reads as a collapse
in travel and is really a difference in elapsed time. The same figure will read
"+0 %" on 31 December and has moved by nothing in between.

**The design.** Like against like, and say which:

- The **current** year is compared against the same span of the previous year —
  1 January to today, versus 1 January to the same day a year earlier. The label
  says so: `ggü. gleichem Zeitraum {{year}}` / `vs. same period in {{year}}`.
- A **completed** year keeps the full-year comparison it has now, unchanged, and
  keeps its existing label.
- The cut is "is this year still running", not "is this the year in the system
  clock": a user viewing 2024 in 2026 sees a full-year comparison, because 2024
  is over.

**Why not abstain.** This codebase's rule is that a value which cannot be
derived is absent rather than invented — but this one CAN be derived. Dropping
the delta for the current year would remove a true statement; the old delta was
not untrue for lack of data but for comparing two different lengths of time. The
fix is the right window, not silence.

**The visible consequence, which is the point.** The number on screen changes —
substantially, and for every user whose current year is incomplete. That belongs
in the release notes, not in a quiet commit.

- [ ] **Step 1: Write the failing test.** Fixture: a user with 10 experiences in
      Jan–Sep of the previous year and 8 in Jan–Sep of the current one, plus 20
      more in Oct–Dec of the previous year. Today is in September.
      Expected: the current year's delta is 8 vs 10 (−20 %), NOT 8 vs 30 (−73 %).
      A second case asserts a completed year still compares against the full
      previous year.
- [ ] **Step 2: Run it and watch it fail** — it currently reports the full-year
      comparison.
- [ ] **Step 3: Implement the window.** Find every place the year-over-year
      delta is computed (start from `backend/src/routes/stats.ts` and
      `services/stats/summary.ts`; the comparison may be assembled on the
      frontend, in which case the same rule goes to the one place that owns it —
      NOT to each tile).
- [ ] **Step 4: The label travels with the number.** A delta whose window is
      "same period" must never render under a label that says "vs 2025", or the
      fix becomes a second, quieter lie. DE and EN in the same commit.
- [ ] **Step 5: Run the suite, `tsc`, lint, `check:size`.**
- [ ] **Step 6: Commit**, and say in the message that a visible number moves and
      why.
