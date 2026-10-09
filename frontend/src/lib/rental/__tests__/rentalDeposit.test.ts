import { describe, expect, it } from "vitest";
import { depositSummary, rentalDeposit, type RentalDepositFields } from "../rentalDeposit";

const none: RentalDepositFields = {
  depositAmount: null,
  depositCurrency: null,
  depositPaidOn: null,
  depositReturnedOn: null,
  depositReturnedAmount: null,
};
const held = { ...none, depositAmount: 300, depositCurrency: "USD", depositPaidOn: "2026-07-01" };

describe("rentalDeposit (forgejo#238)", () => {
  it.each([
    ["nothing recorded", none, "none", null],
    ["held, not returned", held, "open", 300],
    [
      "returned in full",
      { ...held, depositReturnedOn: "2026-07-10", depositReturnedAmount: 300 },
      "returned",
      0,
    ],
    [
      "partly returned",
      { ...held, depositReturnedOn: "2026-07-10", depositReturnedAmount: 250 },
      "partial",
      50,
    ],
    [
      "a return date without its amount",
      { ...held, depositReturnedOn: "2026-07-10" },
      "returnedAmountUnknown",
      null,
    ],
    [
      "an amount nobody wrote the size of, held",
      { ...none, depositPaidOn: "2026-07-01" },
      "open",
      null,
    ],
  ] as const)("%s", (_label, fields, state, outstanding) => {
    expect(rentalDeposit(fields)).toEqual({ state, outstanding });
  });
});

describe("depositSummary", () => {
  const t = (key: string, o?: Record<string, unknown>) => (o ? `${key}${JSON.stringify(o)}` : key);
  const money = (amount: number, currency: string | null) => `${amount} ${currency}`;
  const day = (iso: string) => iso;

  it("says nothing without a deposit", () => {
    expect(depositSummary(t, none, money, day)).toBeNull();
  });

  it("names a partial refund and what is still outstanding, in the deposit's currency", () => {
    const line = depositSummary(
      t,
      { ...held, depositReturnedOn: "2026-07-10", depositReturnedAmount: 250 },
      money,
      day
    );
    expect(line).toContain(
      'rental:deposit.partial{"returned":"250 USD","amount":"300 USD","outstanding":"50 USD"}'
    );
    expect(line).toContain("rental:deposit.paidOn");
  });
});
