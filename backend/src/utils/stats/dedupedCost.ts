import {
  hasRecordedBookingPrice,
  hasRecordedOwnCost,
  recordedOwnAmount,
} from "../../shared/flightPricing";

export interface CostFlight {
  price: number | null;
  taxes: number | null;
  fees: number | null;
  currency: string | null;
  /** Base-currency value of this flight's own cost, snapshotted on write. */
  priceBase: number | null;
  /** Which base currency that snapshot is in — a stale one must not be summed. */
  fxBaseCurrency: string | null;
  bookingId: string | null;
  booking: {
    price: number | null;
    currency: string | null;
    priceBase: number | null;
    fxBaseCurrency: string | null;
  } | null;
}

export interface DedupedCost {
  /**
   * Total in the user's base currency. Contains ONLY amounts that carry a
   * snapshot in that currency — never a raw figure from another one.
   *
   * `null`, not 0, when no amount reached it (forgejo#83): a year in which
   * no flight carries a price used to read "Gesamtkosten 0 €", which is a
   * claim — "these flights were free" — and not the truth, "nothing was
   * recorded". The caller renders a dash and says how many flights had no
   * price. Amounts that exist but could not be converted are not in `base`
   * either; they sit in `unconvertedByCurrency`, and `base` is null when
   * they are all there is.
   *
   * A year whose flights were all recorded as free reports 0, not null. That
   * is the opposite claim and the correct one — someone wrote the zero down
   * (SRV-STATS-ZERO-PRICE-001).
   */
  base: number | null;
  /** Flights whose own price or whose booking's price was recorded — 0 counts. */
  pricedFlights: number;
  /**
   * Flights nobody put a number on — no price, taxes or fees of their own and
   * no booking amount. A flight recorded as free is NOT one of these; it is
   * priced, at 0.
   */
  unpricedFlights: number;
  /**
   * Amounts that could not be converted, kept in the currency they were paid
   * in. Reported beside the total rather than folded into it. An entry here is
   * not an error: an undated flight has no day to look a rate up for, and a
   * price whose currency was never recorded has no unit at all.
   */
  unconvertedByCurrency: Record<string, number>;
  /**
   * This flight's own contribution to `base`, RAW and unrounded, in the same
   * order as the input `flights` array — 0 for an unpriced flight, for a
   * flight recorded as free, for a later segment of a booking already
   * counted, and for an amount that could not convert (it is in
   * `unconvertedByCurrency` instead). Read `perFlightPriced` to tell the
   * first two apart. Added so evidence
   * resolvers can reuse this EXACT rule per-row rather than re-deriving it
   * (`services/evidence/metricEvidenceFlightCore.ts`, `businessTotalCost`,
   * and `services/stats/summary.ts`'s `yearTotalCost`) — the alternative, a
   * second cost loop that merely resembles this one, is the drift this
   * feature exists to prevent.
   */
  perFlightBaseContribution: number[];
  /** This flight's own `share.priced`, same order — true even when its booking's amount was counted on an earlier segment. */
  perFlightPriced: boolean[];
}

/**
 * Total cost with booking dedupe — the SAME rules as businessStats.ts (kept in
 * sync by hand; businessStats' loop also attributes distance, so the rule is
 * knowingly duplicated, not shared): a booking price counts once per booking
 * and is all-in (per-flight taxes/fees NOT added on top); flights without a
 * recorded booking price fall back to price + taxes + fees.
 *
 * "Recorded", not "positive" — `shared/flightPricing.ts` owns that
 * distinction. A booking explicitly saved at 0 is a free booking and its
 * segments do NOT fall back to their own columns; only a booking with no
 * amount at all does.
 *
 * Currency-aware since #267. This function used to add every amount together
 * regardless of currency and return one number, which the UI then rendered with
 * the user's display symbol — so a 300 USD flight and a 300 EUR flight were
 * reported as "600 €", authoritative-looking and wrong. `Flight.currency` was
 * stored the whole time and no statistics path read it.
 *
 * Conversion happens on WRITE (`services/fx/snapshot.ts`), not here: a rate is
 * a rate on a day, and re-converting at read time would make last year's total
 * move every time the ECB publishes.
 */
/** What one flight contributes to a cost total, in the currency it was paid in. */
export interface FlightCostShare {
  /**
   * The amount to add here, or `null` when there is nothing to add — no price
   * was ever recorded, or this flight's booking was already counted on an
   * earlier segment.
   *
   * `0` and `null` are DIFFERENT answers and were the same one until the
   * 2026-09-20 audit (SRV-STATS-ZERO-PRICE-001): 0 is a free flight, null is
   * an unknown one, and a caller that adds them together reports a year of
   * award tickets as a year nobody priced.
   */
  amount: number | null;
  currency: string | null;
  /** Base-currency snapshot of `amount`, where one exists. */
  amountBase: number | null;
  snapshotCurrency: string | null;
  /** True even when `amount` is 0 because the booking was counted elsewhere. */
  priced: boolean;
}

/**
 * The rule for what a flight costs, in ONE place.
 *
 * Two things are easy to get wrong separately and were: a flight's own cost is
 * its price PLUS taxes and fees, and a booking shared by several segments is
 * counted once across them. `computeDedupedTotalCost` converts to a base
 * currency afterwards, while the trip account sums by original currency and
 * never converts — so the rule is here and the arithmetic stays with each
 * caller. The trip account previously added `flight.price` alone, which
 * dropped both halves: two segments sharing a 300 EUR booking contributed
 * nothing, and 100 + 20 tax + 10 fees was reported as 100 (AUD-080).
 *
 * `countedBookingIds` is carried by the caller and mutated here, because
 * "already counted" is a property of the run, not of the flight.
 */
export function flightCostShare(
  flight: CostFlight,
  countedBookingIds: Set<string>
): FlightCostShare {
  if (flight.bookingId && hasRecordedBookingPrice(flight.booking)) {
    // Every segment of a priced booking is a priced flight, even though the
    // booking's amount is added once.
    const first = !countedBookingIds.has(flight.bookingId);
    if (first) countedBookingIds.add(flight.bookingId);
    return {
      amount: first ? flight.booking!.price : null,
      currency: flight.booking!.currency,
      amountBase: first ? flight.booking!.priceBase : null,
      snapshotCurrency: flight.booking!.fxBaseCurrency,
      priced: true,
    };
  }

  return {
    amount: recordedOwnAmount(flight),
    currency: flight.currency,
    amountBase: flight.priceBase,
    snapshotCurrency: flight.fxBaseCurrency,
    priced: hasRecordedOwnCost(flight),
  };
}

export function computeDedupedTotalCost(flights: CostFlight[], baseCurrency: string): DedupedCost {
  const seenBookingIds = new Set<string>();
  let base = 0;
  let contributedToBase = false;
  let pricedFlights = 0;
  let unpricedFlights = 0;
  const unconvertedByCurrency: Record<string, number> = {};
  const perFlightBaseContribution: number[] = [];
  const perFlightPriced: boolean[] = [];

  // Returns what THIS call added to `base`, RAW — 0 when nothing did, so a
  // caller can attribute the total back to individual rows without a second
  // pass over the same amounts.
  const add = (
    amount: number | null,
    amountBase: number | null,
    snapshotCurrency: string | null,
    ownCurrency: string | null
  ): number => {
    // Nothing to add: no price was recorded, or this row's booking amount
    // already landed on an earlier segment. NOT the same as a recorded 0,
    // which falls through and marks the total as answered.
    if (amount === null) return 0;
    // An amount already IN the base currency needs no conversion and no
    // snapshot — 300 EUR in a EUR logbook is 300 EUR. This matters beyond
    // tidiness: every row written before #267 has a null snapshot, and without
    // this branch the introduction of FX would have silently emptied the cost
    // total of every existing logbook until some backfill ran.
    if (ownCurrency === baseCurrency) {
      base += amount;
      contributedToBase = true;
      return amount;
    }
    // A snapshot only counts when it is in the base currency being reported.
    // A user who switched base currency has snapshots in the old one; summing
    // those would be the same lie in a different coat.
    if (amountBase !== null && snapshotCurrency === baseCurrency) {
      base += amountBase;
      contributedToBase = true;
      return amountBase;
    }
    // Zero is the one amount that needs no rate: it is zero in every
    // currency. Bucketing it as unconvertible would report "0 USD still
    // outstanding" beside a total that stayed null, so a flight explicitly
    // saved as free would read "no price recorded" (SRV-STATS-ZERO-PRICE-001).
    if (amount === 0) {
      contributedToBase = true;
      return 0;
    }
    // No unit recorded is its own bucket. It is NOT assumed to be the base
    // currency — that assumption is how 11,662 AED became €11,662 once already.
    const key = ownCurrency ?? "unknown";
    unconvertedByCurrency[key] =
      Math.round(((unconvertedByCurrency[key] ?? 0) + amount) * 100) / 100;
    return 0;
  };

  for (const flight of flights) {
    const share = flightCostShare(flight, seenBookingIds);
    if (share.priced) pricedFlights++;
    else unpricedFlights++;
    perFlightPriced.push(share.priced);
    perFlightBaseContribution.push(
      add(share.amount, share.amountBase, share.snapshotCurrency, share.currency)
    );
  }

  return {
    base: contributedToBase ? Math.round(base * 100) / 100 : null,
    pricedFlights,
    unpricedFlights,
    unconvertedByCurrency,
    perFlightBaseContribution,
    perFlightPriced,
  };
}
