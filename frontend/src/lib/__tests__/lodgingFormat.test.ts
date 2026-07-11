import { describe, it, expect } from "vitest";
import { formatStayPriceDisplay, nightsBetween, type StayPriceSnapshot } from "../lodgingFormat";

function makeSnapshot(overrides: Partial<StayPriceSnapshot> = {}): StayPriceSnapshot {
  return {
    totalPrice: 840,
    currency: "CHF",
    totalPriceBase: 883,
    fxRate: 0.9895,
    fxRateDate: "2024-05-12T00:00:00.000Z",
    fxBaseCurrency: "EUR",
    ...overrides,
  };
}

describe("formatStayPriceDisplay", () => {
  it("renders the full FX readout when the snapshot is complete", () => {
    const result = formatStayPriceDisplay(makeSnapshot(), "de", "EZB");

    expect(result.fxReadout).not.toBeNull();
    expect(result.fxReadout).toContain("→");
    expect(result.fxReadout).toContain("0,9895");
    expect(result.fxReadout).toContain("EZB");
    expect(result.fxReadout).toContain("12.05.24");
    expect(result.original).not.toMatch(/null|NaN|undefined/);
  });

  it("renders the original price alone — no null/NaN/dangling arrow — when the FX snapshot is null", () => {
    const result = formatStayPriceDisplay(
      makeSnapshot({
        totalPriceBase: null,
        fxRate: null,
        fxRateDate: null,
        fxBaseCurrency: null,
      }),
      "de",
      "EZB"
    );

    expect(result.fxReadout).toBeNull();
    expect(result.original).not.toBe("");
    expect(result.original).not.toMatch(/null|NaN|undefined/);
    expect(result.original).not.toContain("→");
  });

  it("treats a partially-null snapshot (only some FX fields present) as absent, never a partial readout", () => {
    const result = formatStayPriceDisplay(
      makeSnapshot({ fxRate: null }), // totalPriceBase/fxRateDate/fxBaseCurrency still set
      "de",
      "EZB"
    );

    expect(result.fxReadout).toBeNull();
    expect(result.original).not.toMatch(/null|NaN|undefined/);
  });

  it("shows '—' for original price when there is no price at all, never blank/null/NaN", () => {
    const result = formatStayPriceDisplay(
      makeSnapshot({
        totalPrice: null,
        totalPriceBase: null,
        fxRate: null,
        fxRateDate: null,
        fxBaseCurrency: null,
      }),
      "de",
      "EZB"
    );

    expect(result.original).toBe("—");
    expect(result.fxReadout).toBeNull();
  });

  it("uses an en-US-ish rate format for the English locale", () => {
    const result = formatStayPriceDisplay(makeSnapshot(), "en", "ECB");
    expect(result.fxReadout).toContain("0.9895");
    expect(result.fxReadout).toContain("ECB");
  });
});

describe("nightsBetween", () => {
  it("computes whole nights between check-in and check-out", () => {
    expect(nightsBetween("2024-05-12T15:00:00.000Z", "2024-05-14T11:00:00.000Z")).toBe(2);
  });

  it("never returns a negative value for a malformed range", () => {
    expect(nightsBetween("2024-05-14T00:00:00.000Z", "2024-05-12T00:00:00.000Z")).toBe(0);
  });
});
