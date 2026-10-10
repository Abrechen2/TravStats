import { localDay } from "../../shared/time/instant";
import {
  odometerDistanceKm,
  rentalCost,
  rentalDays,
  rentalDrivenKm,
  rentalYear,
  type RentalDrivenKmSource,
} from "../../shared/rentalCounting";

/**
 * The rental figures forgejo#262 adds to the statistics tab, over the rentals
 * `shared/rentalCounting.ts` already counted (completed only).
 *
 * Three rules carry them:
 *
 *  - **One subset per ratio.** Km per rental day and cost per km are each
 *    computed over the rentals that carry BOTH halves of the ratio — never km
 *    from one set divided by days or money from another, which would invent
 *    a figure no rental supports. Each ratio names how many rentals it stands on.
 *  - **Booked against billed only where the bill is secured.** The comparison
 *    reads a rental whose final amount came from the invoice (or a labelled
 *    hand correction) AND whose booked price is in the same currency. A
 *    rental billed in another currency than it was booked in is counted as
 *    such, never converted. A deposit is never read: it is money held, not a
 *    cost (forgejo#238).
 *  - **No upgrade without an order.** There is no explicit ordering of
 *    vehicle classes in the data, so the promised and the driven car are
 *    compared NEUTRALLY — same model or another one — and nothing is called
 *    an upgrade.
 *
 * Pure: the caller loads the rows.
 */

export interface RentalExtraRow {
  id: string;
  status: string;
  provider: string;
  broker: string | null;
  pickupTime: Date;
  pickupTimezone: string;
  returnTime: Date;
  returnTimezone: string;
  price: number | null;
  currency: string | null;
  finalAmount: number | null;
  finalCurrency: string | null;
  finalAmountSource: string | null;
  distanceKm: number | null;
  distanceSource: string | null;
  odometerOutKm: number | null;
  odometerInKm: number | null;
  vehicleClass: string | null;
  acrissCode: string | null;
  vehicleExample: string | null;
  vehicleDriven: string | null;
}

export interface RentalExtraStats {
  /** Rentals booked through a broker, and directly with the counter's company. */
  brokered: { viaBroker: number; direct: number };
  /** Km per rental day over the rentals with known km; null when none has any. */
  kmPerDay: { value: number | null; rentals: number; km: number; days: number };
  /** Per currency, over rentals carrying both a known cost and known km. */
  costPerKm: Array<{ currency: string; perKm: number; rentals: number; km: number }>;
  /** Per currency, booked vs billed, over rentals with a secured final amount in the booked currency. */
  bookedVsFinal: {
    byCurrency: Array<{
      currency: string;
      rentals: number;
      booked: number;
      final: number;
      difference: number;
    }>;
    /** Billed in another currency than booked: compared nowhere, said here. */
    otherCurrency: number;
  };
  vehicles: {
    /** Distinct driven models, spelling folded, among rentals that name one. */
    distinctDriven: number;
    withDriven: number;
    /** Booked classes as printed (or the ACRISS code), most rented first. */
    classes: Array<{ label: string; rentals: number }>;
    /** Promised example against the car driven, neutrally — no class order exists. */
    promisedVsDriven: { compared: number; sameModel: number; otherModel: number };
  };
  records: {
    longest: { id: string; days: number; provider: string } | null;
    farthest: { id: string; km: number; source: RentalDrivenKmSource | null } | null;
    /** Providers whose FIRST completed rental falls in the period, oldest first. */
    newProviders: string[];
  };
  /** Rentals with BOTH odometer readings — the "Kilometerbuch" badge's figure. */
  odometerDocumented: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round1 = (n: number): number => Math.round(n * 10) / 10;
const fold = (s: string): string => s.trim().replace(/\s+/g, " ").toLocaleLowerCase();
const providerKey = (p: string): string => fold(p);

/** The final amount is secured when the invoice gave it or the user corrected it by hand. */
const SECURED_FINAL_SOURCES: readonly string[] = ["invoice", "user"];

function bookedVsFinal(rows: readonly RentalExtraRow[]): RentalExtraStats["bookedVsFinal"] {
  const byCurrency = new Map<string, { rentals: number; booked: number; final: number }>();
  let otherCurrency = 0;
  for (const r of rows) {
    if (r.price === null || !r.currency || r.finalAmount === null || !r.finalCurrency) continue;
    if (!SECURED_FINAL_SOURCES.includes(r.finalAmountSource ?? "")) continue;
    if (r.currency !== r.finalCurrency) {
      otherCurrency += 1;
      continue;
    }
    const cur = byCurrency.get(r.currency) ?? { rentals: 0, booked: 0, final: 0 };
    byCurrency.set(r.currency, {
      rentals: cur.rentals + 1,
      booked: cur.booked + r.price,
      final: cur.final + r.finalAmount,
    });
  }
  return {
    byCurrency: [...byCurrency.entries()]
      .map(([currency, v]) => ({
        currency,
        rentals: v.rentals,
        booked: round2(v.booked),
        final: round2(v.final),
        difference: round2(v.final - v.booked),
      }))
      .sort((a, b) => b.rentals - a.rentals || a.currency.localeCompare(b.currency)),
    otherCurrency,
  };
}

/** Booked through a broker — a broker named on the rental. */
export const isBrokered = (r: Pick<RentalExtraRow, "broker">): boolean => Boolean(r.broker?.trim());

/** The driven model, spelling folded — what "distinct models" counts; null when none is named. */
export const drivenModelKey = (r: Pick<RentalExtraRow, "vehicleDriven">): string | null =>
  r.vehicleDriven?.trim() ? fold(r.vehicleDriven) : null;

/** Both the promised example and the driven car are named — the neutral comparison's sample. */
export const comparesVehicle = (
  r: Pick<RentalExtraRow, "vehicleExample" | "vehicleDriven">
): boolean => Boolean(r.vehicleExample?.trim() && r.vehicleDriven?.trim());

function vehicles(rows: readonly RentalExtraRow[]): RentalExtraStats["vehicles"] {
  const driven = rows.flatMap((r) => {
    const key = drivenModelKey(r);
    return key === null ? [] : [key];
  });
  const classes = new Map<string, { label: string; rentals: number }>();
  for (const r of rows) {
    const label = r.vehicleClass?.trim() || r.acrissCode?.trim().toUpperCase() || null;
    if (!label) continue;
    const key = fold(label);
    const cur = classes.get(key) ?? { label, rentals: 0 };
    classes.set(key, { ...cur, rentals: cur.rentals + 1 });
  }
  const compared = rows.filter(comparesVehicle);
  // "VW Golf or similar" promises a Golf; the "or similar" is not part of the model.
  const model = (s: string): string =>
    fold(s).replace(/\s+(or similar|oder ähnlich|o\.\s?ä\.)\s*$/u, "");
  const sameModel = compared.filter(
    (r) => model(r.vehicleExample as string) === model(r.vehicleDriven as string)
  ).length;
  return {
    distinctDriven: new Set(driven).size,
    withDriven: driven.length,
    classes: [...classes.values()]
      .sort((a, b) => b.rentals - a.rentals || a.label.localeCompare(b.label))
      .slice(0, 10),
    promisedVsDriven: {
      compared: compared.length,
      sameModel,
      otherModel: compared.length - sameModel,
    },
  };
}

const pickupDay = (r: Pick<RentalExtraRow, "pickupTime" | "pickupTimezone">): string =>
  localDay(r.pickupTime, r.pickupTimezone);

type RecordRow = Pick<
  RentalExtraRow,
  | "id"
  | "provider"
  | "pickupTime"
  | "pickupTimezone"
  | "returnTime"
  | "returnTimezone"
  | "distanceKm"
  | "distanceSource"
  | "odometerOutKm"
  | "odometerInKm"
>;

/** The longest rental by rental days — the tab's record and its panel's one row. */
export function longestRental<T extends RecordRow>(
  scoped: readonly T[]
): { row: T; days: number } | null {
  let best: { row: T; days: number } | null = null;
  for (const r of scoped) {
    const days = rentalDays(r);
    if (best === null || days > best.days) best = { row: r, days };
  }
  return best;
}

/** The rental with the most known driven km. A stored 0 km is no distance record (review M2). */
export function farthestRental<T extends RecordRow>(
  scoped: readonly T[]
): { row: T; km: number; source: RentalDrivenKmSource | null } | null {
  let best: { row: T; km: number; source: RentalDrivenKmSource | null } | null = null;
  for (const r of scoped) {
    const driven = rentalDrivenKm(r);
    if (driven !== null && driven.km > 0 && (best === null || driven.km > best.km)) {
      best = { row: r, km: driven.km, source: driven.source };
    }
  }
  return best;
}

/**
 * Each provider's FIRST counted rental, over every rental, kept when it falls
 * in the period on screen — a provider is new in the period its first rental
 * is in, which the period alone cannot see.
 */
export function newProviderFirsts<T extends RecordRow>(
  scoped: readonly T[],
  all: readonly T[]
): T[] {
  const firstOf = new Map<string, T>();
  for (const r of [...all].sort(
    (a, b) => pickupDay(a).localeCompare(pickupDay(b)) || a.id.localeCompare(b.id)
  )) {
    if (!firstOf.has(providerKey(r.provider))) firstOf.set(providerKey(r.provider), r);
  }
  const scopedIds = new Set(scoped.map((r) => r.id));
  return [...firstOf.values()].filter((r) => scopedIds.has(r.id));
}

/** The provider key `newProviderFirsts` folds by, for a distinct credit. */
export const rentalProviderKey = (provider: string): string => providerKey(provider);

function records(
  scoped: readonly RentalExtraRow[],
  all: readonly RentalExtraRow[]
): RentalExtraStats["records"] {
  const longest = longestRental(scoped);
  const farthest = farthestRental(scoped);
  return {
    longest: longest
      ? { id: longest.row.id, days: longest.days, provider: longest.row.provider }
      : null,
    farthest: farthest ? { id: farthest.row.id, km: farthest.km, source: farthest.source } : null,
    newProviders: newProviderFirsts(scoped, all).map((r) => r.provider.trim()),
  };
}

/** Km per rental day stands on the rentals with known driven km (`rentalDrivenKm`). */
export const kmPerDayStandsOn = (r: RecordRow): boolean => rentalDrivenKm(r) !== null;

/**
 * Cost per km stands on the rentals carrying BOTH a known cost and known km —
 * and more than 0 km, since a driven 0 km cannot carry a price per km.
 */
export const costPerKmStandsOn = (r: RentalExtraRow): boolean => {
  const driven = rentalDrivenKm(r);
  return driven !== null && driven.km > 0 && rentalCost(r) !== null;
};

/**
 * @param scoped the counted rentals of the period on screen
 * @param all    every counted rental — a provider is NEW in the period its
 *               first rental falls in, which the period cannot see alone
 */
export function computeRentalExtraStats(
  scoped: readonly RentalExtraRow[],
  all: readonly RentalExtraRow[] = scoped
): RentalExtraStats {
  let kmSum = 0;
  let kmDays = 0;
  let kmRentals = 0;
  const perKm = new Map<string, { amount: number; km: number; rentals: number }>();
  for (const r of scoped) {
    const driven = rentalDrivenKm(r);
    if (driven === null) continue;
    kmSum += driven.km;
    kmDays += rentalDays(r);
    kmRentals += 1;
    if (!costPerKmStandsOn(r)) continue;
    const cost = rentalCost(r)!;
    const cur = perKm.get(cost.currency) ?? { amount: 0, km: 0, rentals: 0 };
    perKm.set(cost.currency, {
      amount: cur.amount + cost.amount,
      km: cur.km + driven.km,
      rentals: cur.rentals + 1,
    });
  }
  const viaBroker = scoped.filter(isBrokered).length;
  return {
    brokered: { viaBroker, direct: scoped.length - viaBroker },
    kmPerDay: {
      value: kmRentals > 0 ? round1(kmSum / kmDays) : null,
      rentals: kmRentals,
      km: kmSum,
      days: kmDays,
    },
    costPerKm: [...perKm.entries()]
      .map(([currency, v]) => ({
        currency,
        perKm: round2(v.amount / v.km),
        rentals: v.rentals,
        km: v.km,
      }))
      .sort((a, b) => b.rentals - a.rentals || a.currency.localeCompare(b.currency)),
    bookedVsFinal: bookedVsFinal(scoped),
    vehicles: vehicles(scoped),
    records: records(scoped, all),
    odometerDocumented: scoped.filter(
      (r) => odometerDistanceKm(r.odometerOutKm, r.odometerInKm) !== null
    ).length,
  };
}

/** The year cut the statistics apply: the pickup's year, up to "MM-DD" when a running year is compared. */
export function inRentalPeriod(
  r: Pick<RentalExtraRow, "pickupTime" | "pickupTimezone">,
  year: number | null,
  until: string | null
): boolean {
  if (year === null) return true;
  if (rentalYear(r) !== year) return false;
  return until === null || pickupDay(r) <= `${year}-${until}`;
}
