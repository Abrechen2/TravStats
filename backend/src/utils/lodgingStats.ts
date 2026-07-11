export interface LodgingStayData {
  lodgingId: string;
  type: string;
  country: string | null;
  city: string | null;
  chainId: number | null;
  checkIn: Date;
  checkOut: Date;
  status: string;
  totalPriceBase: number | null;
  /** The base currency this stay's `totalPriceBase` was snapshotted into — NOT necessarily the user's CURRENT base currency (see spendBaseByCurrency). */
  fxBaseCurrency: string | null;
  currency: string | null;
  totalPrice: number | null;
  isAwardStay: boolean;
  ratingOverall: number | null;
}

/**
 * Minimal shape of a `Lodging` row needed to count hotels the user HAS
 * (including ones with no stay yet) — passed optionally to
 * `calculateLodgingStats` alongside the stays.
 */
export interface LodgingRecord {
  id: string;
  chainId: number | null;
  type: string;
  country: string | null;
  city: string | null;
}

export interface LodgingStats {
  lodgingsCount: number;
  staysCount: number;
  totalNights: number;
  /** Nights allocated to the correct year — see calculateLodgingStats for the walk rule. */
  nightsByYear: Record<string, number>;
  /** "YYYY-MM" — same per-night allocation as nightsByYear. */
  nightsByMonth: Record<string, number>;
  longestStayNights: number;
  chainsUnique: number;
  citiesUnique: number;
  countries: Set<string>;
  countriesCount: number;
  /**
   * Sum of totalPriceBase, but ONLY for stays whose `fxBaseCurrency` matches
   * the CURRENT base currency passed into `calculateLodgingStats` — a stay
   * snapshotted before the user switched their base currency keeps its OLD
   * fxBaseCurrency forever (the snapshot is never recalculated), so it must
   * never be silently added under the new currency's label (finding 2).
   */
  spendBaseTotal: number;
  /** Original amounts grouped by their original currency — not a conversion. */
  spendByCurrency: Record<string, number>;
  /** Every totalPriceBase amount grouped by the currency it was snapshotted into — the full picture behind spendBaseTotal's single current-base slice. */
  spendBaseByCurrency: Record<string, number>;
  awardNights: number;
  /**
   * Nights broken down by `Lodging.type` (hotel/campsite/guesthouse/apartment/
   * hostel/…). A plain `Record` rather than named `hotelNights`/`campsiteNights`
   * fields — the vocabulary grows over time (see `LODGING_TYPES` in
   * schemas/lodging.ts) and a fixed field per type would need a matching edit
   * here every time. Keys are whatever `LodgingStayData.type` values are
   * actually present in the input; a type with zero nights has no key at all
   * (never a `0` entry).
   */
  nightsByType: Record<string, number>;
  avgRatingOverall: number | null;
  chainLoyaltyMax: number;
  sameHotelRepeatMax: number;
}

/**
 * Pure statistics rollup for the lodging domain. No I/O, no Prisma.
 *
 * Night allocation: a "night" belongs to the calendar date it starts on
 * (check-out day itself contributes no night). Dates are walked in UTC —
 * `checkIn`/`checkOut` arrive as `Date` objects normalized to UTC midnight,
 * so stepping via `Date.UTC(...)` day-by-day is immune to local-timezone
 * shifts and DST boundaries (no local-time arithmetic ever divides a day
 * into fractional hours that could round into the wrong bucket).
 *
 * `lodgings` is optional and, when supplied, changes the semantics of
 * `lodgingsCount` and `chainsUnique`: instead of being derived only from
 * stays seen (a hotel with zero stays would otherwise be invisible), they
 * count every lodging the user HAS. Its cities/countries are folded into
 * the shared city/country sets too — a hotel added in a new country counts
 * as that country even before the user has stayed there. Callers that omit
 * `lodgings` keep today's stay-derived behaviour (back-compat).
 */
export function calculateLodgingStats(
  stays: LodgingStayData[],
  currentBaseCurrency = "EUR",
  lodgings?: LodgingRecord[],
): LodgingStats {
  const activeStays = stays.filter((s) => s.status !== "cancelled");

  const lodgingIds = new Set<string>();
  const chainIds = new Set<number>();
  const cities = new Set<string>();
  const countries = new Set<string>();
  const nightsByYear: Record<string, number> = {};
  const nightsByMonth: Record<string, number> = {};
  const spendByCurrency: Record<string, number> = {};
  const spendBaseByCurrency: Record<string, number> = {};
  const nightsByType: Record<string, number> = {};
  const lodgingCounts = new Map<string, number>();
  const chainCounts = new Map<number, number>();

  let totalNights = 0;
  let longestStayNights = 0;
  let awardNights = 0;
  let ratingSum = 0;
  let ratingCount = 0;

  for (const stay of activeStays) {
    lodgingIds.add(stay.lodgingId);
    if (stay.chainId !== null) chainIds.add(stay.chainId);
    if (stay.city) cities.add(stay.city);
    if (stay.country) countries.add(stay.country);

    lodgingCounts.set(
      stay.lodgingId,
      (lodgingCounts.get(stay.lodgingId) ?? 0) + 1,
    );
    if (stay.chainId !== null) {
      chainCounts.set(stay.chainId, (chainCounts.get(stay.chainId) ?? 0) + 1);
    }

    if (stay.currency) {
      const amount = stay.totalPrice ?? 0;
      spendByCurrency[stay.currency] =
        (spendByCurrency[stay.currency] ?? 0) + amount;
    }
    if (stay.totalPriceBase !== null && stay.fxBaseCurrency !== null) {
      spendBaseByCurrency[stay.fxBaseCurrency] =
        (spendBaseByCurrency[stay.fxBaseCurrency] ?? 0) + stay.totalPriceBase;
    }

    if (stay.ratingOverall !== null) {
      ratingSum += stay.ratingOverall;
      ratingCount += 1;
    }

    const stayNights = walkNights(
      stay.checkIn,
      stay.checkOut,
      nightsByYear,
      nightsByMonth,
    );
    totalNights += stayNights;
    if (stayNights > longestStayNights) longestStayNights = stayNights;

    if (stay.isAwardStay) awardNights += stayNights;
    if (stayNights > 0) {
      nightsByType[stay.type] = (nightsByType[stay.type] ?? 0) + stayNights;
    }
  }

  let chainLoyaltyMax = 0;
  for (const count of chainCounts.values()) {
    if (count > chainLoyaltyMax) chainLoyaltyMax = count;
  }
  let sameHotelRepeatMax = 0;
  for (const count of lodgingCounts.values()) {
    if (count > sameHotelRepeatMax) sameHotelRepeatMax = count;
  }

  // When the caller supplies the user's full lodgings list, lodgingsCount/
  // chainsUnique count hotels the user HAS (including ones with no stay
  // yet), and their cities/countries fold into the shared sets too.
  let lodgingsCount = lodgingIds.size;
  let chainsUnique = chainIds.size;
  if (lodgings) {
    const lodgingChainIds = new Set<number>();
    for (const l of lodgings) {
      if (l.chainId !== null) lodgingChainIds.add(l.chainId);
      if (l.city) cities.add(l.city);
      if (l.country) countries.add(l.country);
    }
    lodgingsCount = lodgings.length;
    chainsUnique = lodgingChainIds.size;
  }

  return {
    lodgingsCount,
    staysCount: activeStays.length,
    totalNights,
    nightsByYear,
    nightsByMonth,
    longestStayNights,
    chainsUnique,
    citiesUnique: cities.size,
    countries,
    countriesCount: countries.size,
    spendBaseTotal: spendBaseByCurrency[currentBaseCurrency] ?? 0,
    spendByCurrency,
    spendBaseByCurrency,
    awardNights,
    nightsByType,
    avgRatingOverall:
      ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
    chainLoyaltyMax,
    sameHotelRepeatMax,
  };
}

/**
 * Walks each night of a stay (checkIn up to but excluding checkOut) in UTC,
 * bucketing it into `nightsByYear`/`nightsByMonth` by the date it starts on.
 * Mutates the two accumulator records in place (private helper, not the
 * public input); returns the number of nights walked.
 */
function walkNights(
  checkIn: Date,
  checkOut: Date,
  nightsByYear: Record<string, number>,
  nightsByMonth: Record<string, number>,
): number {
  let nights = 0;
  let cursor = Date.UTC(
    checkIn.getUTCFullYear(),
    checkIn.getUTCMonth(),
    checkIn.getUTCDate(),
  );
  const end = Date.UTC(
    checkOut.getUTCFullYear(),
    checkOut.getUTCMonth(),
    checkOut.getUTCDate(),
  );

  while (cursor < end) {
    const d = new Date(cursor);
    const year = String(d.getUTCFullYear());
    const month = `${year}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    nightsByYear[year] = (nightsByYear[year] ?? 0) + 1;
    nightsByMonth[month] = (nightsByMonth[month] ?? 0) + 1;
    nights += 1;
    cursor += 24 * 60 * 60 * 1000;
  }

  return nights;
}
