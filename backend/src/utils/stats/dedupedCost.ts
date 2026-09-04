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
   */
  base: number | null;
  /** Flights whose own price or whose booking's price was recorded. */
  pricedFlights: number;
  /** Flights that contributed nothing — no price, no priced booking. */
  unpricedFlights: number;
  /**
   * Amounts that could not be converted, kept in the currency they were paid
   * in. Reported beside the total rather than folded into it. An entry here is
   * not an error: an undated flight has no day to look a rate up for, and a
   * price whose currency was never recorded has no unit at all.
   */
  unconvertedByCurrency: Record<string, number>;
}

/**
 * Total cost with booking dedupe — the SAME rules as businessStats.ts (kept in
 * sync by hand; businessStats' loop also attributes distance, so the rule is
 * knowingly duplicated, not shared): a booking price counts once per booking
 * and is all-in (per-flight taxes/fees NOT added on top); flights without a
 * priced booking fall back to price + taxes + fees. Truthiness matches
 * businessStats: booking price 0/null -> fallback.
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
export function computeDedupedTotalCost(flights: CostFlight[], baseCurrency: string): DedupedCost {
  const seenBookingIds = new Set<string>();
  let base = 0;
  let contributedToBase = false;
  let pricedFlights = 0;
  let unpricedFlights = 0;
  const unconvertedByCurrency: Record<string, number> = {};

  const add = (
    amount: number,
    amountBase: number | null,
    snapshotCurrency: string | null,
    ownCurrency: string | null,
  ): void => {
    if (amount === 0) return;
    // An amount already IN the base currency needs no conversion and no
    // snapshot — 300 EUR in a EUR logbook is 300 EUR. This matters beyond
    // tidiness: every row written before #267 has a null snapshot, and without
    // this branch the introduction of FX would have silently emptied the cost
    // total of every existing logbook until some backfill ran.
    if (ownCurrency === baseCurrency) {
      base += amount;
      contributedToBase = true;
      return;
    }
    // A snapshot only counts when it is in the base currency being reported.
    // A user who switched base currency has snapshots in the old one; summing
    // those would be the same lie in a different coat.
    if (amountBase !== null && snapshotCurrency === baseCurrency) {
      base += amountBase;
      contributedToBase = true;
      return;
    }
    // No unit recorded is its own bucket. It is NOT assumed to be the base
    // currency — that assumption is how 11,662 AED became €11,662 once already.
    const key = ownCurrency ?? "unknown";
    unconvertedByCurrency[key] = Math.round(((unconvertedByCurrency[key] ?? 0) + amount) * 100) / 100;
  };

  for (const flight of flights) {
    if (flight.bookingId && flight.booking?.price) {
      // Every segment of a priced booking is a priced flight, even though the
      // booking's amount is added once.
      pricedFlights++;
      if (!seenBookingIds.has(flight.bookingId)) {
        seenBookingIds.add(flight.bookingId);
        add(
          flight.booking.price,
          flight.booking.priceBase,
          flight.booking.fxBaseCurrency,
          flight.booking.currency,
        );
      }
    } else {
      const own = (flight.price ?? 0) + (flight.taxes ?? 0) + (flight.fees ?? 0);
      if (own > 0) pricedFlights++;
      else unpricedFlights++;
      add(own, flight.priceBase, flight.fxBaseCurrency, flight.currency);
    }
  }

  return {
    base: contributedToBase ? Math.round(base * 100) / 100 : null,
    pricedFlights,
    unpricedFlights,
    unconvertedByCurrency,
  };
}
