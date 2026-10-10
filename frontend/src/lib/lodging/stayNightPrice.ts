/**
 * The two "per night" figures of one stay, kept apart and explained
 * (forgejo#178). An invoice reading 3 × 120 € room + 30 € breakfast + 12 € city
 * tax = 402 € was "pro Nacht 120 €" in the app and "Pro Übernachtung 134 €" on
 * the web — both right, neither saying which it was:
 *
 *   - `roomRate`: the STORED room rate per night (`pricePerNight`), as the
 *     booking states it. Shown as "Zimmer pro Nacht".
 *   - `average`: the stay's total divided by its nights — everything paid for
 *     the stay as booked (room, extras, fees, taxes), not per person — with
 *     the calculation shown beside it.
 *
 * The rule for when the average appears is the Companion's: only with a total
 * and a KNOWN night count (an unknown length is no divisor — no invented
 * average), not for one night without a room rate (it would repeat the total),
 * and not when it equals the room rate (it would repeat that). `extras` is what
 * the total carries beyond room rate × nights, when that is positive.
 */
export interface StayNightPriceInput {
  totalPrice: number | null;
  pricePerNight: number | null;
  /** Null when the length of the stay is not known. */
  nights: number | null;
}

export interface StayNightPrice {
  roomRate: number | null;
  average: { total: number; nights: number; perNight: number } | null;
  extras: number | null;
}

const cents = (n: number): number => Math.round(n * 100);

export function stayNightPrice(stay: StayNightPriceInput): StayNightPrice {
  const roomRate =
    stay.pricePerNight !== null && stay.pricePerNight > 0 ? stay.pricePerNight : null;
  const { totalPrice: total, nights } = stay;
  if (total === null || nights === null || nights <= 0) {
    return { roomRate, average: null, extras: null };
  }
  const perNight = total / nights;
  const repeatsTotal = nights === 1 && roomRate === null;
  const repeatsRate = roomRate !== null && cents(perNight) === cents(roomRate);
  const beyond = roomRate !== null ? total - roomRate * nights : null;
  return {
    roomRate,
    average: repeatsTotal || repeatsRate ? null : { total, nights, perNight },
    extras: beyond !== null && cents(beyond) > 0 ? beyond : null,
  };
}
