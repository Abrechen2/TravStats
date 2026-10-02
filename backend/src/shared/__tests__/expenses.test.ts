import { sumByCurrency } from "../expenses";

describe("sumByCurrency — expense totals", () => {
  it("never adds two currencies together", () => {
    expect(
      sumByCurrency([
        { amount: 300, currency: "EUR" },
        { amount: 300, currency: "USD" },
        { amount: 12.5, currency: "EUR" },
      ])
    ).toEqual({ EUR: 312.5, USD: 300 });
  });

  it("adds decimals exactly, without float drift", () => {
    expect(
      sumByCurrency([
        { amount: 0.1, currency: "EUR" },
        { amount: 0.2, currency: "EUR" },
      ])
    ).toEqual({ EUR: 0.3 });
  });

  it("keeps a third decimal for a three-decimal currency", () => {
    expect(
      sumByCurrency([
        { amount: 1.125, currency: "KWD" },
        { amount: 2.25, currency: "KWD" },
      ])
    ).toEqual({ KWD: 3.375 });
  });

  it("is empty, not zero, when nothing was spent", () => {
    expect(sumByCurrency([])).toEqual({});
  });
});
