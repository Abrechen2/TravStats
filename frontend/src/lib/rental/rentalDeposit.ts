/**
 * Where a rental's deposit stands (forgejo#238). A deposit is money held, not
 * money spent: it never enters a cost (`rentalCost` does not read it), and
 * this reading only says whether it came back.
 *
 * - `none` — nothing recorded.
 * - `open` — held, not returned yet (no return date, no returned amount).
 * - `partial` — returned, but less than was held: the rest is `outstanding`.
 * - `returned` — returned in full (or more was never held).
 * - `returnedAmountUnknown` — a return date without the amount: TravStats
 *   does not assume it was all of it.
 *
 * Everything is in the DEPOSIT's own currency, which may differ from the
 * rental's price; nothing is converted.
 */
export type RentalDepositState = "none" | "open" | "partial" | "returned" | "returnedAmountUnknown";

export interface RentalDepositFields {
  depositAmount: number | null;
  depositCurrency: string | null;
  depositPaidOn: string | null;
  depositReturnedOn: string | null;
  depositReturnedAmount: number | null;
}

export interface RentalDepositReading {
  state: RentalDepositState;
  /** Still held, in the deposit's currency; null when it cannot be said. */
  outstanding: number | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function rentalDeposit(d: RentalDepositFields): RentalDepositReading {
  const recorded =
    d.depositAmount !== null ||
    d.depositPaidOn !== null ||
    d.depositReturnedOn !== null ||
    d.depositReturnedAmount !== null;
  if (!recorded) return { state: "none", outstanding: null };
  if (d.depositReturnedAmount !== null) {
    if (d.depositAmount !== null && d.depositReturnedAmount < d.depositAmount) {
      return { state: "partial", outstanding: round2(d.depositAmount - d.depositReturnedAmount) };
    }
    return { state: "returned", outstanding: 0 };
  }
  if (d.depositReturnedOn !== null) return { state: "returnedAmountUnknown", outstanding: null };
  return { state: "open", outstanding: d.depositAmount };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The deposit in one line for the detail page and the return card: where it
 * stands, then its days. Amounts in the deposit's own currency through
 * `money`; null when no deposit is recorded (the caller then says nothing or
 * `deposit.none`).
 */
export function depositSummary(
  t: Translate,
  d: RentalDepositFields,
  money: (amount: number, currency: string | null) => string,
  day: (iso: string) => string
): string | null {
  const reading = rentalDeposit(d);
  if (reading.state === "none") return null;
  const m = (amount: number | null): string =>
    amount === null ? "–" : money(amount, d.depositCurrency);
  const head =
    reading.state === "open"
      ? d.depositAmount === null
        ? t("rental:deposit.openUnknownAmount")
        : t("rental:deposit.open", { amount: m(d.depositAmount) })
      : reading.state === "partial"
        ? t("rental:deposit.partial", {
            returned: m(d.depositReturnedAmount),
            amount: m(d.depositAmount),
            outstanding: m(reading.outstanding),
          })
        : reading.state === "returned"
          ? t("rental:deposit.returned", { returned: m(d.depositReturnedAmount) })
          : t("rental:deposit.returnedAmountUnknown", { day: day(d.depositReturnedOn ?? "") });
  const days = [
    d.depositPaidOn ? t("rental:deposit.paidOn", { day: day(d.depositPaidOn) }) : null,
    d.depositReturnedOn && reading.state !== "returnedAmountUnknown"
      ? t("rental:deposit.returnedOn", { day: day(d.depositReturnedOn) })
      : null,
  ].filter(Boolean);
  return [head, ...days].join(" · ");
}
