import type { Lodging, LodgingStay, Prisma } from "../../../prisma";
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
  return pickFacts(row, LODGING_STAY_FACT_FIELDS) satisfies Partial<
    Prisma.LodgingStayUncheckedCreateInput
  >;
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
 * "Hotel Adlon Kempinski" and "hotel adlon  kempinski" are one house: case,
 * accents and punctuation are not identity. Used to reuse a recipient's own
 * lodging instead of creating a second record of the same building.
 */
export function normalisedLodgingName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
