import type { Lodging, LodgingStay, Prisma } from "../../../prisma";
import { calculateDistance } from "../../../utils/geo";
import { pickFacts } from "./pick";

/**
 * A stay's facts: the dates and times of the stay, as stored in the hotel's
 * zone (ADR 0002), how precisely they are known, and the board. Private: room
 * number and category, guests, every price and FX column, ratings, amenities
 * of the room, booking reference, loyalty membership, companions, notes.
 */
export const LODGING_STAY_FACT_FIELDS = [
  "checkIn",
  "checkOut",
  "checkInTime",
  "checkOutTime",
  "checkInDate",
  "checkOutDate",
  "checkInAt",
  "checkOutAt",
  "stayZone",
  "datePrecision",
  "nights",
  "status",
  "board",
] as const satisfies readonly (keyof LodgingStay)[];

export type LodgingStayFactField = (typeof LODGING_STAY_FACT_FIELDS)[number];

export function lodgingStayFacts(row: Pick<LodgingStay, LodgingStayFactField>) {
  return pickFacts(
    row,
    LODGING_STAY_FACT_FIELDS
  ) satisfies Partial<Prisma.LodgingStayUncheckedCreateInput>;
}

/**
 * The house itself, for creating it in an account that has no such house
 * yet. `chainId` is left to the caller: since 2.7 a chain may be one user's
 * own row, which another account must not point at.
 */
export const LODGING_FACT_FIELDS = [
  "type",
  "name",
  "address",
  "city",
  "country",
  "isoCountryCode",
  "lat",
  "lon",
  "stars",
  "website",
  "wikidataId",
  "amenities",
] as const satisfies readonly (keyof Lodging)[];

export type LodgingFactField = (typeof LODGING_FACT_FIELDS)[number];

export function lodgingFacts(row: Pick<Lodging, LodgingFactField>) {
  return pickFacts(row, LODGING_FACT_FIELDS) satisfies Partial<Prisma.LodgingUncheckedCreateInput>;
}

/**
 * "Hotel Adlon Kempinski" and "hotel adlon  kempinski" are one name: case,
 * accents and punctuation are not identity. A name alone is NOT a house —
 * see `isSameHouse`.
 */
export function normalisedLodgingName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Two coordinates closer than this are one building's (entrance vs. centroid). */
export const SAME_HOUSE_RADIUS_KM = 0.3;

export type HouseIdentity = Pick<
  Lodging,
  "name" | "lat" | "lon" | "city" | "country" | "isoCountryCode"
>;

const hasCoordinates = (h: HouseIdentity): h is HouseIdentity & { lat: number; lon: number } =>
  h.lat !== null && h.lon !== null;

function sameCountry(a: HouseIdentity, b: HouseIdentity): boolean {
  if (a.isoCountryCode && b.isoCountryCode) return a.isoCountryCode === b.isoCountryCode;
  const ca = normalisedLodgingName(a.country ?? "");
  const cb = normalisedLodgingName(b.country ?? "");
  return ca !== "" && ca === cb;
}

/**
 * May a recipient's own lodging stand in for the sharer's? Name AND place:
 * "Hotel Europa" in Berlin and "Hotel Europa" in Rome are two houses, and a
 * stay filed under the wrong one is a wrong night in the wrong country. The
 * same normalised name, and then either both coordinates within
 * `SAME_HOUSE_RADIUS_KM`, or — when either side has none — the same city and
 * country. Anything less is a new lodging: a duplicate the user can merge is
 * recoverable, a stay silently moved to another city is not.
 */
export function isSameHouse(a: HouseIdentity, b: HouseIdentity): boolean {
  if (normalisedLodgingName(a.name) !== normalisedLodgingName(b.name)) return false;
  if (hasCoordinates(a) && hasCoordinates(b)) {
    return calculateDistance(a.lat, a.lon, b.lat, b.lon) <= SAME_HOUSE_RADIUS_KM;
  }
  const cityA = normalisedLodgingName(a.city ?? "");
  const cityB = normalisedLodgingName(b.city ?? "");
  return cityA !== "" && cityA === cityB && sameCountry(a, b);
}
