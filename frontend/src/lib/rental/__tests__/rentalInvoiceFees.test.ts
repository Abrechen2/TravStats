import { describe, expect, it } from "vitest";
import { feesTotal, invoiceFeeRows, pickedFeeIndexes } from "../rentalInvoiceFees";

const toll = { label: "Mautgebühren", amount: 12.4, currency: "EUR" };
const fuel = { label: "Tankfüllung", amount: 45.6, currency: "EUR" };

describe("rentalInvoiceFees (forgejo#237)", () => {
  it("marks a line the rental already holds, by label, amount and currency", () => {
    const rows = invoiceFeeRows({ invoiceFees: [toll] }, { fees: [fuel, toll] });
    expect(rows.map((r) => [r.index, r.recorded])).toEqual([
      [0, false],
      [1, true],
    ]);
    expect(invoiceFeeRows(null, { fees: [toll] })[0].recorded).toBe(false);
    expect(invoiceFeeRows(null, {})).toEqual([]);
  });

  it("adds lines in cents and refuses a total across currencies", () => {
    expect(feesTotal([toll, fuel])).toEqual({ amount: 58, currency: "EUR" });
    expect(feesTotal([toll, { ...fuel, currency: "CHF" }])).toBeNull();
    expect(feesTotal([])).toBeNull();
  });

  it("sends the ticked lines' indexes", () => {
    expect(pickedFeeIndexes([false, true, true])).toEqual([1, 2]);
  });
});
