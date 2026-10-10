import { describe, expect, it } from "vitest";

import {
  createBody,
  editPatch,
  expenseDraft,
  rateInvalid,
  type ExpenseDraft,
} from "../expenseDraft";
import { fxOutcomeNotice, parseRate } from "../expenseFx";
import type { TripExpense } from "../../../types/expense";

const VERSION = "2026-07-01T00:00:00.000Z";
const CONTEXT = { baseCurrency: "EUR", today: "2026-07-20" };

const stored = (over: Partial<TripExpense> = {}): TripExpense => ({
  id: "e1",
  tripId: null,
  routeId: "rt",
  stopId: null,
  legFromStopId: null,
  legToStopId: null,
  kind: "ferry",
  amount: 890,
  currency: "NOK",
  date: "2026-07-14",
  note: null,
  payer: null,
  fx: {
    amountBase: 77.25,
    rate: 0.0868,
    rateDate: "2026-07-14",
    baseCurrency: "EUR",
    source: "ecb",
  },
  documentCount: 0,
  createdAt: VERSION,
  updatedAt: VERSION,
  ...over,
});

const edit = (expense: TripExpense, change: Partial<ExpenseDraft>) => {
  const initial = expenseDraft(expense, "EUR");
  return editPatch(initial, { ...initial, ...change }, VERSION, CONTEXT);
};

describe("expenseDraft — payer and rate (forgejo#150)", () => {
  it("opens an expense with its payer and its stored rate, and an untouched rate mode", () => {
    const draft = expenseDraft(stored({ payer: { companionId: "c1", name: "Anna" } }), "EUR");
    expect(draft).toMatchObject({
      payerMode: "companion",
      payerCompanionId: "c1",
      payerName: "Anna",
      fxMode: "keep",
      fxRate: "0.0868",
    });
    expect(
      expenseDraft(stored({ payer: { companionId: null, name: "Ole" } }), "EUR")
    ).toMatchObject({ payerMode: "name", payerName: "Ole" });
  });

  it("sends neither payer nor rate when neither was touched", () => {
    expect(edit(stored(), { amount: "900" })).toEqual({ amount: 900, baseVersion: VERSION });
  });

  it("sends the payer alone when only the payer changed", () => {
    expect(edit(stored(), { payerMode: "companion", payerCompanionId: "c2" })).toEqual({
      payer: { companionId: "c2" },
      baseVersion: VERSION,
    });
    expect(edit(stored(), { payerMode: "name", payerName: "  Ole " })).toEqual({
      payer: { name: "Ole" },
      baseVersion: VERSION,
    });
    expect(
      edit(stored({ payer: { companionId: "c1", name: "Anna" } }), {
        payerMode: "none",
        payerCompanionId: "",
        payerName: "",
      })
    ).toEqual({ payer: null, baseVersion: VERSION });
  });

  it("sends a typed rate as manual, for the expense's day, into the reader's base", () => {
    expect(edit(stored(), { fxMode: "manual", fxRate: "0,09" })).toEqual({
      fx: { rate: 0.09, rateDate: "2026-07-14", baseCurrency: "EUR", source: "manual" },
      baseVersion: VERSION,
    });
  });

  it("dates a typed rate today when the expense has no day", () => {
    const body = createBody(
      { ...expenseDraft(null, "NOK"), amount: "100", fxMode: "manual", fxRate: "0.087" },
      CONTEXT
    );
    expect(body.fx).toEqual({
      rate: 0.087,
      rateDate: "2026-07-20",
      baseCurrency: "EUR",
      source: "manual",
    });
  });

  it("removes the rate with an explicit null", () => {
    expect(edit(stored(), { fxMode: "remove" })).toEqual({ fx: null, baseVersion: VERSION });
  });

  it("sends no typed rate for a cost already in the base currency", () => {
    const body = createBody(
      { ...expenseDraft(null, "EUR"), amount: "10", fxMode: "manual", fxRate: "2" },
      CONTEXT
    );
    expect("fx" in body).toBe(false);
    expect("payer" in body).toBe(false);
  });

  it("holds an unusable typed rate back instead of sending it", () => {
    const draft = { ...expenseDraft(stored(), "EUR"), fxMode: "manual" as const, fxRate: "0" };
    expect(rateInvalid(draft, "EUR")).toBe(true);
    expect(parseRate("abc")).toBeNull();
    expect(parseRate("-1")).toBeNull();
    expect(parseRate("1,5")).toBe(1.5);
  });

  it("names the two write outcomes the reader must hear about, and only those", () => {
    expect(fxOutcomeNotice("lookupFailed")?.type).toBe("warning");
    expect(fxOutcomeNotice("keptStoredRate")?.type).toBe("info");
    for (const quiet of ["supplied", "snapshotted", "unchanged", "undated", "removed"] as const) {
      expect(fxOutcomeNotice(quiet)).toBeNull();
    }
  });
});
