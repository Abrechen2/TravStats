import { buildExpenseAccount } from "../expenseAccount";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("buildExpenseAccount — expenses per year and in total", () => {
  it("puts each expense in the year of its own local day, per currency", () => {
    const account = buildExpenseAccount([
      { amount: 1290, currency: "NOK", date: day("2026-07-16") },
      { amount: 40, currency: "EUR", date: day("2026-07-14") },
      { amount: 18, currency: "EUR", date: day("2025-12-31") },
    ]);
    expect(account.years).toEqual([
      { year: "2025", count: 1, byCurrency: { EUR: 18 } },
      { year: "2026", count: 2, byCurrency: { NOK: 1290, EUR: 40 } },
    ]);
    expect(account.totalByCurrency).toEqual({ NOK: 1290, EUR: 58 });
    expect(account.count).toBe(3);
  });

  it("counts an undated expense in the total and in no year", () => {
    const account = buildExpenseAccount([
      { amount: 30, currency: "EUR", date: null },
      { amount: 10, currency: "EUR", date: day("2026-01-01") },
    ]);
    expect(account.years).toEqual([{ year: "2026", count: 1, byCurrency: { EUR: 10 } }]);
    expect(account.undatedByCurrency).toEqual({ EUR: 30 });
    expect(account.totalByCurrency).toEqual({ EUR: 40 });
  });

  it("is empty, not zero, without any expense", () => {
    expect(buildExpenseAccount([])).toEqual({
      count: 0,
      totalByCurrency: {},
      years: [],
      undatedByCurrency: {},
    });
  });
});
