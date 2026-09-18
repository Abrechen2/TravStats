import {
  assertBooleanInvariant,
  assertDistinctInvariant,
  assertExtremumInvariant,
  assertRatioInvariant,
  assertSequenceInvariant,
  assertSumInvariant,
} from "./invariants";
import type { EvidenceEntry, EvidenceMeasure, EvidenceResponse } from "../../../schemas/evidence";

/**
 * Fixtures for the invariant harness. Each one is built to be a case a
 * NAIVE implementation of its invariant would get right for the wrong
 * reason, or wrong outright — see the comment on each fixture for which
 * mistake it catches. `invariants.ts` documents the rules; this file is
 * where each rule is watched to actually fail on the input it exists for.
 */

function measure(overrides: Partial<EvidenceMeasure> = {}): EvidenceMeasure {
  return {
    kind: "metric",
    key: "test:key",
    aggregation: "sum",
    label: { key: "test.label" },
    unit: "count",
    value: 0,
    scope: { period: { kind: "allTime" } },
    ...overrides,
  };
}

function entry(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    domain: "flight",
    id: "entry-1",
    href: null,
    title: { text: "entry" },
    subtitle: null,
    date: null,
    ...overrides,
  };
}

function response(overrides: Partial<EvidenceResponse> = {}): EvidenceResponse {
  return {
    measure: measure(),
    entries: [],
    returned: 0,
    omitted: { count: 0 },
    unattributed: [],
    page: { offset: 0, limit: 100 },
    ...overrides,
  };
}

describe("assertSumInvariant", () => {
  const round = (n: number) => Math.round(n);

  it("passes when the total is rounded once, at the end", () => {
    // Trap 3: two RAW contributions of 0.6. round(0.6)+round(0.6) = 2 is the
    // per-row-rounding mistake the spec names; round(0.6+0.6) = 1 is correct.
    // This fixture is the correct shape — value is 1, not 2.
    const res = response({
      measure: measure({ aggregation: "sum", value: 1 }),
      entries: [entry({ id: "a", contribution: 0.6 }), entry({ id: "b", contribution: 0.6 })],
      returned: 2,
    });
    expect(() => assertSumInvariant(res, round)).not.toThrow();
  });

  it("fails on the per-row-rounded total a naive sum would produce", () => {
    // Same two 0.6 contributions, but value claims the per-row-rounded
    // total (2). A naive check that rounded each entry before summing
    // would agree with this; the correct invariant must reject it.
    const res = response({
      measure: measure({ aggregation: "sum", value: 2 }),
      entries: [entry({ id: "a", contribution: 0.6 }), entry({ id: "b", contribution: 0.6 })],
      returned: 2,
    });
    expect(() => assertSumInvariant(res, round)).toThrow(/sum invariant failed/);
  });

  it("counts the omitted bucket's contribution, not just the returned page", () => {
    // Trap 4: a paged response whose `omitted` bucket carries contribution.
    // A check that folded `omitted` into `unattributed` (or ignored it
    // outright) would compute 5, not the true 12.
    const res = response({
      measure: measure({ aggregation: "sum", value: 12 }),
      entries: [entry({ id: "a", contribution: 5 })],
      returned: 1,
      omitted: { count: 1, contribution: 7 },
    });
    expect(() => assertSumInvariant(res, round)).not.toThrow();
  });

  it("fails when omitted.contribution is dropped from the total", () => {
    const res = response({
      // Claims the value is just the returned page's contribution (5),
      // silently ignoring the 7 sitting in `omitted`.
      measure: measure({ aggregation: "sum", value: 5 }),
      entries: [entry({ id: "a", contribution: 5 })],
      returned: 1,
      omitted: { count: 1, contribution: 7 },
    });
    expect(() => assertSumInvariant(res, round)).toThrow(/sum invariant failed/);
  });

  it("rejects a wrong aggregation label outright", () => {
    const res = response({ measure: measure({ aggregation: "distinct", value: 0 }) });
    expect(() => assertSumInvariant(res, round)).toThrow(/expected aggregation "sum"/);
  });

  it("passes when value is null and unattributed explains why", () => {
    const res = response({
      measure: measure({ aggregation: "sum", value: null }),
      unattributed: [{ count: 3, reason: "notPerEntry" }],
    });
    expect(() => assertSumInvariant(res, round)).not.toThrow();
  });
});

describe("assertDistinctInvariant", () => {
  it("passes when one row credits two units (an international flight)", () => {
    // Trap 1: ONE row, TWO credits. A summing check (`entries.length` or
    // `credits.length` summed) would also land on 2 here — by accident,
    // for the wrong reason — which is exactly why this fixture alone
    // cannot prove the invariant; the next test is the one that can.
    const res = response({
      measure: measure({ aggregation: "distinct", value: 2 }),
      entries: [entry({ id: "flight-1", credits: ["DE", "FR"] })],
      returned: 1,
    });
    expect(() => assertDistinctInvariant(res)).not.toThrow();
  });

  it("passes when five rows credit one shared unit — the trap a sum fails", () => {
    // Trap 2: FIVE rows, each crediting the SAME unit. A row-summing check
    // says 5; the truth, and what the invariant must accept, is 1 — this is
    // the case the original single-sum design could not express at all.
    const res = response({
      measure: measure({ aggregation: "distinct", value: 1 }),
      entries: [
        entry({ id: "flight-1", credits: ["DE"] }),
        entry({ id: "flight-2", credits: ["DE"] }),
        entry({ id: "flight-3", credits: ["DE"] }),
        entry({ id: "flight-4", credits: ["DE"] }),
        entry({ id: "flight-5", credits: ["DE"] }),
      ],
      returned: 5,
    });
    expect(() => assertDistinctInvariant(res)).not.toThrow();
  });

  it("fails when value matches a naive row-count instead of the true union size", () => {
    // The same five-rows-one-unit fixture, but value claims 5 — the answer
    // a naive `entries.length` or `sum(credits.length)` check would accept.
    const res = response({
      measure: measure({ aggregation: "distinct", value: 5 }),
      entries: [
        entry({ id: "flight-1", credits: ["DE"] }),
        entry({ id: "flight-2", credits: ["DE"] }),
        entry({ id: "flight-3", credits: ["DE"] }),
        entry({ id: "flight-4", credits: ["DE"] }),
        entry({ id: "flight-5", credits: ["DE"] }),
      ],
      returned: 5,
    });
    expect(() => assertDistinctInvariant(res)).toThrow(/distinct invariant failed/);
  });

  it("adds the omitted bucket's credit count without folding it into unattributed", () => {
    const res = response({
      measure: measure({ aggregation: "distinct", value: 4 }),
      entries: [entry({ id: "flight-1", credits: ["DE", "FR"] })],
      returned: 1,
      omitted: { count: 2, credits: 2 },
    });
    expect(() => assertDistinctInvariant(res)).not.toThrow();
  });

  it("passes when value is null and unattributed explains why", () => {
    const res = response({
      measure: measure({ aggregation: "distinct", value: null }),
      unattributed: [{ count: 1, reason: "locationHistoryOnly" }],
    });
    expect(() => assertDistinctInvariant(res)).not.toThrow();
  });

  it("fails when value is null but unattributed is empty", () => {
    // Trap 7: a null value with nothing explaining it is a silent failure,
    // not a legitimate abstention — must be rejected outright.
    const res = response({
      measure: measure({ aggregation: "distinct", value: null }),
      unattributed: [],
    });
    expect(() => assertDistinctInvariant(res)).toThrow(/unattributed is empty/);
  });
});

describe("assertExtremumInvariant", () => {
  // Minutes between two ISO timestamps stashed in `date.value` — a stand-in
  // for whatever a real resolver derives a layover's length from. The point
  // under test is that `assertExtremumInvariant` recomputes rather than
  // trusts `measure.value`, not the specific formula.
  const minutesBetween = (entries: EvidenceEntry[]): number => {
    const times = entries.map((e) => new Date(e.date!.value).getTime());
    return Math.round((Math.max(...times) - Math.min(...times)) / 60_000);
  };

  it("passes when recomputing over TWO witnesses reproduces the value", () => {
    // A layover is derived from a PAIR of flights, not one — the arrival of
    // the first and the departure of the second. A check that assumed
    // exactly one witness (the record-per-row assumption the spec's
    // "What the first version got wrong" section names) could not even
    // represent this fixture.
    const res = response({
      measure: measure({ aggregation: "extremum", value: 90, unit: "minutes" }),
      entries: [
        entry({ id: "arrival", date: { value: "2026-05-01T10:00:00Z", precision: "day" } }),
        entry({ id: "departure", date: { value: "2026-05-01T11:30:00Z", precision: "day" } }),
      ],
      returned: 2,
    });
    expect(() => assertExtremumInvariant(res, minutesBetween)).not.toThrow();
  });

  it("fails when the reported value does not match the witnesses", () => {
    const res = response({
      measure: measure({ aggregation: "extremum", value: 999, unit: "minutes" }),
      entries: [
        entry({ id: "arrival", date: { value: "2026-05-01T10:00:00Z", precision: "day" } }),
        entry({ id: "departure", date: { value: "2026-05-01T11:30:00Z", precision: "day" } }),
      ],
      returned: 2,
    });
    expect(() => assertExtremumInvariant(res, minutesBetween)).toThrow(/extremum invariant failed/);
  });

  it("fails when value is not null but there are no witnesses", () => {
    const res = response({
      measure: measure({ aggregation: "extremum", value: 90, unit: "minutes" }),
      entries: [],
      returned: 0,
    });
    expect(() => assertExtremumInvariant(res, minutesBetween)).toThrow(/no witness/);
  });
});

describe("assertRatioInvariant", () => {
  it("passes when numerator / denominator reproduces the value", () => {
    const res = response({
      measure: measure({ aggregation: "ratio", value: 0.25, numerator: 25, denominator: 100 }),
    });
    expect(() => assertRatioInvariant(res)).not.toThrow();
  });

  it("fails when the denominator is missing — never treated as 1", () => {
    // Trap 5: numerator present, denominator absent. `numerator / (denominator
    // ?? 1)` would silently read this as `25 / 1 = 25`; the invariant must
    // reject the shape outright instead of guessing a denominator.
    const res = response({
      measure: measure({ aggregation: "ratio", value: 25, numerator: 25 }),
    });
    expect(() => assertRatioInvariant(res)).toThrow(/numerator and denominator are both required/);
  });

  it("fails when the numerator is missing", () => {
    const res = response({
      measure: measure({ aggregation: "ratio", value: 0.25, denominator: 100 }),
    });
    expect(() => assertRatioInvariant(res)).toThrow(/numerator and denominator are both required/);
  });

  it("fails when the computed ratio disagrees with the reported value", () => {
    const res = response({
      measure: measure({ aggregation: "ratio", value: 0.9, numerator: 25, denominator: 100 }),
    });
    expect(() => assertRatioInvariant(res)).toThrow(/ratio invariant failed/);
  });
});

describe("assertBooleanInvariant", () => {
  it("passes when value is 1 and at least one row supports it", () => {
    const res = response({
      measure: measure({ aggregation: "boolean", value: 1, unit: "boolean" }),
      entries: [entry({ id: "ocean-crossing" })],
      returned: 1,
    });
    expect(() => assertBooleanInvariant(res)).not.toThrow();
  });

  it("passes when value is 0 with no supporting rows", () => {
    const res = response({
      measure: measure({ aggregation: "boolean", value: 0, unit: "boolean" }),
    });
    expect(() => assertBooleanInvariant(res)).not.toThrow();
  });

  it("fails when value is 1 but no row supports it", () => {
    const res = response({
      measure: measure({ aggregation: "boolean", value: 1, unit: "boolean" }),
      entries: [],
      returned: 0,
    });
    expect(() => assertBooleanInvariant(res)).toThrow(/no row supports it/);
  });

  it("fails when value is neither 0 nor 1", () => {
    const res = response({
      measure: measure({ aggregation: "boolean", value: 2, unit: "boolean" }),
      entries: [entry()],
      returned: 1,
    });
    expect(() => assertBooleanInvariant(res)).toThrow(/value must be 0 or 1/);
  });
});

describe("assertSequenceInvariant", () => {
  const runLength = (entries: EvidenceEntry[]): number => entries.length;

  it("passes when recomputing the run's length reproduces the value", () => {
    const res = response({
      measure: measure({ aggregation: "sequence", value: 3, unit: "days" }),
      entries: [entry({ id: "d1" }), entry({ id: "d2" }), entry({ id: "d3" })],
      returned: 3,
    });
    expect(() => assertSequenceInvariant(res, runLength)).not.toThrow();
  });

  it("fails when the reported streak is longer than its own rows", () => {
    const res = response({
      measure: measure({ aggregation: "sequence", value: 10, unit: "days" }),
      entries: [entry({ id: "d1" }), entry({ id: "d2" }), entry({ id: "d3" })],
      returned: 3,
    });
    expect(() => assertSequenceInvariant(res, runLength)).toThrow(/sequence invariant failed/);
  });

  it("fails when value is not null but the run has no rows", () => {
    const res = response({
      measure: measure({ aggregation: "sequence", value: 3, unit: "days" }),
      entries: [],
      returned: 0,
    });
    expect(() => assertSequenceInvariant(res, runLength)).toThrow(/no rows/);
  });
});
