import type { EvidenceEntry, EvidenceResponse } from "../../../schemas/evidence";

/**
 * The invariant harness for `EvidenceResponse`, written BEFORE any resolver
 * exists (Task 4 of `.superpowers/sdd/2026-09-18-evidence-panel/`), so that
 * no resolver can be written to fit a weak check. One assertion per
 * aggregation kind, each enforcing the invariant named in
 * `docs/superpowers/specs/2026-09-18-evidence-panel-design.md`'s
 * "The model: aggregation kinds" table — never the single
 * `sum(contribution) + unattributed === value` rule that table's own
 * "What the first version got wrong" section refuted with code.
 *
 * Every assertion here throws a descriptive `Error` on violation rather than
 * returning a boolean — `invariants.test.ts` proves each one both accepts a
 * correct `EvidenceResponse` and rejects a wrong one via
 * `expect(() => assertX(bad)).toThrow()`. A guard nobody has watched fail is
 * an assumption, not a guard.
 *
 * WHAT THESE ASSERTIONS DO NOT CATCH, stated plainly because a reader who
 * assumes otherwise will write a weaker test on the strength of it. Most
 * resolvers derive BOTH `measure.value` and `omitted.contribution` from the
 * SAME total (`entryMappers.ts`: `omitted = total - returned`, `value =
 * round(total)`), so `round(returned + omitted) === value` holds BY
 * CONSTRUCTION, for any population whatsoever. A resolver that selected
 * entirely the wrong flights passes it. What the sum and distinct assertions
 * actually prove is INTERNAL CONSISTENCY — that the response's own buckets
 * add up, and that a distinct count is a union and not a row count — and
 * they bite on the population only where `value` comes from a different
 * source than the entries do (the `year*` measures read `computeSummary`'s
 * own stats, `businessTotalCost` reads `computeDedupedTotalCost`).
 *
 * The guard against the wrong POPULATION is a different test entirely: fetch
 * the surface's own endpoint in the same test and assert `measure.value`
 * equals the number that endpoint renders. It is only a population guard
 * where the endpoint computes its number INDEPENDENTLY of the resolver:
 *
 *   - `businessTotalCost` vs `/stats/business` — genuine. `dedupedCost.ts`
 *     and `businessStats.ts` are two hand-kept copies of one rule, and the
 *     cross-check is what makes them drift loudly.
 *   - the three geo counts vs `/stats/airports` — genuine.
 *     `calculateAirportStats` is a second implementation of the same credit
 *     rules.
 *   - the four ranking dimensions vs their own endpoints — genuine, and the
 *     suites that have done this from the start.
 *   - the five `year*` measures vs `/stats/summary?year=` — NOT a population
 *     guard. The route (`routes/stats.ts`) and `metricEvidenceFlightYear.ts`
 *     make the identical `buildWhere(...)` + `computeSummary(...)` calls, so
 *     the two numbers are one number read twice and the comparison cannot
 *     fail on a wrong population — only on ARGUMENT drift, if one side ever
 *     starts passing a different year or base currency. Worth keeping for
 *     that, and named here for what it is: the population of the `year*`
 *     family rests on its `.toBe(<literal>)` assertions.
 *
 * Where no endpoint exists to compare against at all — the scorecard family
 * is computed from `/stats/timeseries` buckets, not a single figure — the
 * literals carry that weight alone, the same way. Both are known limits, not
 * oversights.
 */

/**
 * Every kind shares this rule: `value: null` means "cannot be derived", and
 * the response must say WHY via a non-empty `unattributed` — the endpoint
 * contract ("Four answers that are not the same answer") never returns a
 * null value with nothing to explain it. Called first in every assertion
 * below, before any kind-specific arithmetic runs.
 */
function requireReasonForNull(res: EvidenceResponse): void {
  if (res.measure.value === null && res.unattributed.length === 0) {
    throw new Error(
      "measure.value is null but unattributed is empty — a null value must always carry a reason"
    );
  }
}

function requireAggregation(
  res: EvidenceResponse,
  expected: EvidenceResponse["measure"]["aggregation"]
): void {
  if (res.measure.aggregation !== expected) {
    throw new Error(
      `expected aggregation "${expected}" but got "${res.measure.aggregation}" — wrong invariant for this response`
    );
  }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * `sum`: contributions are RAW and unrounded on every entry; rounding
 * happens exactly ONCE, with `round` — the surface's own rounding step —
 * applied to the total, never to each row first. Two contributions of 0.6
 * round to 1 together and to 2 if rounded per-row first
 * (`invariants.test.ts`'s two-flight fixture is exactly this case), which is
 * why `round` is a parameter rather than baked in here: a caller that
 * rounded before summing would fail THIS assertion, not merely disagree
 * with it silently.
 */
export function assertSumInvariant(res: EvidenceResponse, round: (n: number) => number): void {
  requireAggregation(res, "sum");
  requireReasonForNull(res);
  if (res.measure.value === null) return;

  const returnedContribution = sum(
    res.entries.map((entry, index) => {
      if (entry.contribution === undefined) {
        throw new Error(`entry at index ${index} has no contribution — required for "sum"`);
      }
      return entry.contribution;
    })
  );
  // `round` is applied to BOTH sides. A resolver whose `value` is itself a
  // raw float sum (the scorecard family reports unrounded kilometres and
  // minutes) would otherwise force its caller to pass the identity function,
  // and an identity rounder turns this into strict float equality — green
  // only while the two additions happen to associate the same way. Rounding
  // both sides keeps the property the parameter exists for: two
  // contributions of 0.6 still fail a `value` of 2 under `Math.round`,
  // because 2 rounds to 2 and 1.2 rounds to 1.
  //
  // The unattributed term is counted, exactly as `assertDistinctInvariant`
  // already counts it. It was absent here until task 7b-2, and the
  // asymmetry made `notPerEntry` — "derived across the whole set, no
  // per-row decomposition", which is a SUM's failure mode and no
  // `distinct` measure's — unreachable for every `sum` measure in the
  // registry: any resolver naming it had to report `value: null` and claim
  // a derivable figure could not be derived. `travelAccountHomeNights` is
  // that case: the nights away are subtracted from the year and the
  // remainder was slept at home, with no row that could ever be listed.
  // This admits a resolver that dumps its whole total into `unattributed`,
  // which is a real loss — the cross-check against the surface's own
  // endpoint is what catches that, as it is for every other population
  // question (see the note above).
  const unattributed = sum(res.unattributed.map((u) => u.count));
  const total = round(returnedContribution + (res.omitted.contribution ?? 0) + unattributed);
  const expected = round(res.measure.value);
  if (total !== expected) {
    throw new Error(
      `sum invariant failed: round(${returnedContribution} returned + ${res.omitted.contribution ?? 0} omitted + ${unattributed} unattributed) = ${total}, expected round(${res.measure.value}) = ${expected}`
    );
  }
}

/**
 * The rounder for a measure that reports a RAW float — the scorecard's
 * kilometres and minutes. `(n) => n` was passed there, which made the
 * assertion strict float equality between two independent additions over the
 * same set: correct today only because they happen to associate identically,
 * and a latent flake the moment paging changes the order of one of them.
 * Six decimals is far finer than any figure this product shows and far
 * coarser than the dust two float sums differ by.
 */
export function roundToTolerance(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * `distinct`: the answer is the size of the UNION of credited units, plus
 * whatever the omitted page and the unattributed buckets say is missing —
 * never a count of ROWS. A row may credit two units (an international
 * flight proving two countries) or several rows may credit the SAME unit
 * (five domestic flights proving one country once); a check that summed
 * `credits.length` per row would get the first case right by accident and
 * the second case wrong by exactly the amount the review measured.
 * `omitted.credits` is a bare count, not identities, so it is added as if
 * disjoint from the returned page — the same assumption the contract itself
 * makes by shipping a count instead of a credit list for that bucket.
 */
export function assertDistinctInvariant(res: EvidenceResponse): void {
  requireAggregation(res, "distinct");
  requireReasonForNull(res);
  if (res.measure.value === null) return;

  const distinctReturned = new Set(res.entries.flatMap((entry) => entry.credits ?? []));
  const unattributedUnits = sum(res.unattributed.map((u) => u.count));
  const total = distinctReturned.size + (res.omitted.credits ?? 0) + unattributedUnits;
  if (total !== res.measure.value) {
    throw new Error(
      `distinct invariant failed: |distinct(${distinctReturned.size} returned)| + ${res.omitted.credits ?? 0} omitted + ${unattributedUnits} unattributed = ${total}, expected ${res.measure.value}`
    );
  }
}

/**
 * `extremum`: the entries ARE the witnesses (never a paged subset — a
 * longest-flight or longest-layover value has no "omitted" bucket to speak
 * of), and there may be more than one of them: a layover is derived from
 * TWO flights, not one. `measure` recomputes the value from exactly those
 * witnesses; a caller that trusted `measure.value` without recomputing it
 * would never notice a resolver that reports witnesses inconsistent with
 * its own number.
 */
export function assertExtremumInvariant(
  res: EvidenceResponse,
  measure: (entries: EvidenceEntry[]) => number
): void {
  requireAggregation(res, "extremum");
  requireReasonForNull(res);
  if (res.measure.value === null) return;

  if (res.entries.length === 0) {
    throw new Error("extremum invariant failed: value is not null but there is no witness");
  }
  const recomputed = measure(res.entries);
  if (recomputed !== res.measure.value) {
    throw new Error(
      `extremum invariant failed: recomputing over ${res.entries.length} witness(es) gave ${recomputed}, expected ${res.measure.value}`
    );
  }
}

/**
 * `ratio`: both `numerator` and `denominator` are required together — a
 * missing denominator must be REJECTED, never silently treated as 1, which
 * is the mistake a `numerator / (denominator ?? 1)` implementation would
 * make without anyone noticing until the percentage was wrong.
 */
export function assertRatioInvariant(res: EvidenceResponse): void {
  requireAggregation(res, "ratio");
  requireReasonForNull(res);
  if (res.measure.value === null) return;

  const { numerator, denominator } = res.measure;
  if (numerator === undefined || denominator === undefined) {
    throw new Error(
      `ratio invariant failed: numerator and denominator are both required, got numerator=${numerator}, denominator=${denominator}`
    );
  }
  if (denominator === 0) {
    throw new Error("ratio invariant failed: denominator is 0, so the ratio is undefined");
  }
  const computed = numerator / denominator;
  if (Math.abs(computed - res.measure.value) > Number.EPSILON * Math.max(1, Math.abs(computed))) {
    throw new Error(
      `ratio invariant failed: ${numerator} / ${denominator} = ${computed}, expected ${res.measure.value}`
    );
  }
}

/**
 * `boolean`: `value` is 0 or 1, never any other number, and a `true` (1)
 * answer must be backed by at least one supporting row — a resolver that
 * answered 1 with zero entries would be asserting a fact it cannot show.
 * A `false` (0) answer carries no such requirement: "no ocean crossing
 * found" has nothing to point at by design.
 */
export function assertBooleanInvariant(res: EvidenceResponse): void {
  requireAggregation(res, "boolean");
  requireReasonForNull(res);
  if (res.measure.value === null) return;

  if (res.measure.value !== 0 && res.measure.value !== 1) {
    throw new Error(`boolean invariant failed: value must be 0 or 1, got ${res.measure.value}`);
  }
  if (res.measure.value === 1 && res.entries.length === 0) {
    throw new Error("boolean invariant failed: value is 1 but no row supports it");
  }
}

/**
 * `sequence`: the ordered rows of the run reproduce `value` under
 * `measure` — a streak's length or its span, recomputed from the witnesses
 * exactly as `assertExtremumInvariant` recomputes an extremum, rather than
 * trusted from the resolver's own arithmetic.
 */
export function assertSequenceInvariant(
  res: EvidenceResponse,
  measure: (entries: EvidenceEntry[]) => number
): void {
  requireAggregation(res, "sequence");
  requireReasonForNull(res);
  if (res.measure.value === null) return;

  if (res.entries.length === 0) {
    throw new Error("sequence invariant failed: value is not null but the run has no rows");
  }
  const recomputed = measure(res.entries);
  if (recomputed !== res.measure.value) {
    throw new Error(
      `sequence invariant failed: recomputing over ${res.entries.length} row(s) gave ${recomputed}, expected ${res.measure.value}`
    );
  }
}
