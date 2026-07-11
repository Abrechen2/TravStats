// Frontend view of the `lodging` domain (hotels + campsites). Mirrors
// backend/prisma/schema.prisma (`Lodging`, `LodgingStay`, `LodgingChain`,
// `LodgingMembership`) and backend/src/schemas/lodging.ts (enums + input
// shapes). Kept as hand-mirrored literal unions rather than a cross-package
// import — the frontend build never depends on the backend package, the same
// convention already used for cruise (see types/cruise.ts, CruiseStatus /
// CabinType / the CURRENCIES-mirroring literal union on CruiseInput.currency).
//
// Dates cross the wire as ISO strings, never `Date` objects.

export type LodgingType = "hotel" | "campsite";
export type BoardType = "none" | "breakfast" | "half" | "full" | "all_inclusive";
export type StayStatus = "scheduled" | "completed" | "cancelled";
export type LodgingCurrency = "EUR" | "USD" | "GBP" | "CHF";

export interface LodgingChain {
  id: number;
  name: string;
  brandColor: string | null;
  loyaltyProgram: string | null;
  isUserAdded: boolean;
  createdAt: string;
}

export interface LodgingMembership {
  id: string;
  userId: string;
  programName: string;
  membershipNumber: string | null;
  tier: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LodgingStay {
  id: string;
  lodgingId: string;
  userId: string;
  tripId: string | null;
  bookingId: string | null;
  checkIn: string;
  checkOut: string;
  status: StayStatus;
  roomNumber: string | null;
  roomCategory: string | null;
  board: BoardType | null;
  pricePerNight: number | null;
  currency: LodgingCurrency;
  totalPrice: number | null;
  /**
   * FX snapshot (spec §7.1), taken at the ECB rate for the check-in day.
   * All four fields are null together whenever the ECB lookup failed for
   * this stay — the save still succeeds, so the UI must render a
   * "no conversion available" state rather than assuming a value exists.
   */
  totalPriceBase: number | null;
  fxRate: number | null;
  fxRateDate: string | null;
  fxBaseCurrency: string | null;
  isAwardStay: boolean;
  ratingRoom: number | null;
  ratingBreakfast: number | null;
  ratingService: number | null;
  ratingOverall: number | null;
  roomAmenities: string[];
  bookingReference: string | null;
  membershipId: string | null;
  receiptUrl: string | null;
  companions: string[];
  notes: string | null;
  parserTemplate: string | null;
  parserConfidence: number | null;
  dataSource: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A `Lodging` is the *place* (a hotel, reused across visits). `chain` and
 * `stays` are always included by `routes/lodging.ts` (`LODGING_INCLUDE`).
 *
 * `overallRating`, `stayCount`, `nights`, and `totalSpendBase` are NOT
 * Prisma columns — they're computed server-side per request
 * (`computeAggregates` in routes/lodging.ts) and spread onto every
 * lodging returned from list/get/create/update. `totalSpendBase` isn't
 * named in the Task 14 brief, but the real handler always returns it
 * alongside the other three, so it's included here too.
 */
export interface Lodging {
  id: string;
  userId: string;
  type: LodgingType;
  name: string;
  chainId: number | null;
  chain: LodgingChain | null;
  address: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  stars: number | null;
  amenities: string[];
  notes: string | null;
  dataSource: string | null;
  createdAt: string;
  updatedAt: string;
  stays: LodgingStay[];
  /** Average of this lodging's stays' ratingOverall (nulls ignored); null when none rated. */
  overallRating: number | null;
  stayCount: number;
  nights: number;
  /** Sum of totalPriceBase across stays (already converted to the user's base currency). */
  totalSpendBase: number;
}

// ---- Input shapes ----
// All fields optional on both types (mirroring CruiseInput's convention) so
// the same interface serves create AND update calls; the backend Zod
// schemas (createLodgingSchema / createStaySchema) enforce the fields that
// are actually required on create (e.g. `name`, `checkIn`/`checkOut`).

export interface LodgingInput {
  type?: LodgingType;
  name?: string;
  chainId?: number | null;
  address?: string;
  city?: string;
  country?: string;
  lat?: number | null;
  lon?: number | null;
  stars?: number | null;
  amenities?: string[];
  notes?: string;
}

export interface StayInput {
  checkIn?: string;
  checkOut?: string;
  status?: StayStatus;
  tripId?: string | null;
  bookingId?: string | null;
  roomNumber?: string;
  roomCategory?: string;
  board?: BoardType;
  pricePerNight?: number;
  currency?: LodgingCurrency;
  totalPrice?: number;
  isAwardStay?: boolean;
  ratingRoom?: number;
  ratingBreakfast?: number;
  ratingService?: number;
  ratingOverall?: number;
  roomAmenities?: string[];
  bookingReference?: string;
  membershipId?: string | null;
  receiptUrl?: string;
  companions?: string[];
  notes?: string;
}

/** Chain creation only — there is no update-chain endpoint. `name` is the one required field. */
export interface ChainInput {
  name: string;
  loyaltyProgram?: string;
  brandColor?: string;
}

export interface MembershipInput {
  programName?: string;
  membershipNumber?: string;
  tier?: string;
}

/**
 * Shape of `GET /api/v1/lodging/fx-preview` (routes/lodging.ts). A live,
 * read-only rate lookup used ONLY to render the stay editor's FX readout —
 * `null` whenever the ECB lookup fails, matching the same "no partial
 * conversion" contract as the persisted stay's FX snapshot fields. The
 * AUTHORITATIVE snapshot is still computed server-side at save time
 * (`applyFxSnapshot` in routes/lodging.ts) and stored on the stay itself;
 * this preview never feeds back into that write.
 */
export interface FxPreview {
  baseAmount: number;
  rate: number;
  rateDate: string;
  baseCurrency: string;
}

export interface LodgingListQuery {
  type?: LodgingType;
  chainId?: number;
  tripId?: string;
  year?: number;
  country?: string;
  limit?: number;
  offset?: number;
  sort?: "nights" | "rating" | "spend" | "name" | "checkIn";
}

/**
 * Shape of `GET /api/v1/stats/lodging` (utils/lodgingStats.ts
 * `calculateLodgingStats`). `countries` is serialized as a sorted array by
 * the route handler — the backend's own `LodgingStats.countries` is a
 * `Set<string>` internally, but a bare `Set` JSON-serializes to `{}`, so the
 * handler converts it before the response leaves the server.
 */
export interface LodgingStats {
  lodgingsCount: number;
  staysCount: number;
  totalNights: number;
  /** Nights allocated to the year they start on. Keys are 4-digit year strings. */
  nightsByYear: Record<string, number>;
  /** Keys are "YYYY-MM". */
  nightsByMonth: Record<string, number>;
  longestStayNights: number;
  chainsUnique: number;
  citiesUnique: number;
  countries: string[];
  countriesCount: number;
  /** Sum of totalPriceBase (already converted to the user's base currency). */
  spendBaseTotal: number;
  /** Original amounts grouped by their original currency — not a conversion. */
  spendByCurrency: Record<string, number>;
  awardNights: number;
  hotelNights: number;
  campsiteNights: number;
  avgRatingOverall: number | null;
  chainLoyaltyMax: number;
  sameHotelRepeatMax: number;
}
