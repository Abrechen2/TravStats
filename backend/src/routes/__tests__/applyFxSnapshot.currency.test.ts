import { applyFxSnapshot } from "../lodging";

// No FX mock and no network: the first case returns before any lookup, and
// the second is an identical pair, which `convertToBase` short-circuits.
describe("a price without a currency", () => {
  it("is not quietly treated as euros", async () => {
    const outcome = await applyFxSnapshot(
      { totalPrice: 11662, currency: null, checkIn: "2023-04-30" },
      "EUR"
    );
    expect(outcome.status).toBe("missingCurrency");
  });

  it("still converts when the currency is there", async () => {
    const outcome = await applyFxSnapshot(
      { totalPrice: 100, currency: "EUR", checkIn: "2026-01-01" },
      "EUR"
    );
    expect(outcome.status).toBe("snapshotted");
  });
});
