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
  const total = round(returnedContribution + (res.omitted.contribution ?? 0));
  if (total !== res.measure.value) {
    throw new Error(
      `sum invariant failed: round(${returnedContribution} returned + ${res.omitted.contribution ?? 0} omitted) = ${total}, expected ${res.measure.value}`
    );
  }
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
