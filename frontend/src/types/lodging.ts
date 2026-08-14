import type { CurrencyCode } from "../shared/currencies";
// Frontend view of the `lodging` domain (hotels + campsites). Mirrors
// backend/prisma/schema.prisma (`Lodging`, `LodgingStay`, `LodgingChain`,
// `LodgingMembership`) and backend/src/schemas/lodging.ts (enums + input
// shapes). Kept as hand-mirrored literal unions rather than a cross-package
// import — the frontend build never depends on the backend package, the same
// convention already used for cruise (see types/cruise.ts, CruiseStatus /
// CabinType / the CURRENCIES-mirroring literal union on CruiseInput.currency).
//
// Dates cross the wire as ISO strings, never `Date` objects.

export type LodgingType = "hotel" | "campsite" | "guesthouse" | "apartment" | "hostel";
export type BoardType = "none" | "breakfast" | "half" | "full" | "all_inclusive";
/**
 * `in_progress` ("laufend") joined when lodging status became derived from the
 * dates — a stay whose check-in has passed but whose check-out has not. Mirrors
 * `STAY_STATUSES` in backend/src/schemas/lodging.ts.
 */
export type StayStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
// Any ISO-4217 code — the registry is the single source of truth, mirrored
// from backend/src/shared/currencies.ts. It was four hardcoded codes until
// 2026-08-13, which is why a Dubai booking could not be recorded at all.
export type LodgingCurrency = CurrencyCode;

export interface LodgingChain {
  id: number;
  name: string;
  brandColor: string | null;
  loyaltyProgram: string | null;
  isUserAdded: boolean;
  createdAt: string;
}

/** A chain as it appears on a membership — id + name only, no catalogue detail. */
export interface LodgingChainRef {
  id: number;
  name: string;
}

/** A lodging as it appears on a membership — id + name only, no catalogue detail. */
export interface LodgingRef {
  id: string;
  name: string;
}

export interface LodgingMembership {
  id: string;
  userId: string;
  /** The user's own wording, e.g. "Minor DISCOVERY". Free text, never locked to a catalogue value. */
  programName: string;
  membershipNumber: string | null;
  tier: string | null;
  /** Chains this membership covers, linked by id (see `LodgingMembershipChain` in schema.prisma). */
  chainIds: number[];
  chains: LodgingChainRef[];
  /** Independent hotels this membership covers, linked by id. */
  lodgingIds: string[];
  lodgings: LodgingRef[];
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
  /** Which provider converted it, null if none did. */
  fxSource: FxRateSource | null;
  isAwardStay: boolean;
  ratingRoom: number | null;
  ratingBreakfast: number | null;
  ratingService: number | null;
  ratingOverall: number | null;
  roomAmenities: string[];
  bookingReference: string | null;
  membershipId: string | null;
  /** true = no programme was used for this stay; false = derive from the hotel. */
  membershipOptOut: boolean;
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
  /**
   * Sum of totalPriceBase across this lodging's stays, but ONLY for the
   * ones whose FX snapshot matches the user's CURRENT base currency — a
   * stay snapshotted before a base-currency switch keeps its OLD currency
   * key in `totalSpendBaseByCurrency` forever and is never silently folded
   * into this total.
   */
  totalSpendBase: number;
  /** Every totalPriceBase amount for this lodging, grouped by the currency it was snapshotted into. */
  totalSpendBaseByCurrency: Record<string, number>;
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
  address?: string | null;
  city?: string | null;
  country?: string | null;
  lat?: number | null;
  lon?: number | null;
  stars?: number | null;
  amenities?: string[];
  notes?: string | null;
}

export interface StayInput {
  checkIn?: string;
  checkOut?: string;
  status?: StayStatus;
  tripId?: string | null;
  bookingId?: string | null;
  roomNumber?: string | null;
  roomCategory?: string | null;
  board?: BoardType;
  pricePerNight?: number | null;
  currency?: LodgingCurrency;
  totalPrice?: number | null;
  /**
   * A rate the USER supplies where no provider has one. Not a stay field: the
   * backend turns it into `fxRate` + `fxSource: "manual"`. An explicit null
   * takes it back; omitted means "leave it alone".
   */
  manualFxRate?: number | null;
  isAwardStay?: boolean;
  ratingRoom?: number | null;
  ratingBreakfast?: number | null;
  ratingService?: number | null;
  ratingOverall?: number | null;
  roomAmenities?: string[];
  bookingReference?: string | null;
  membershipId?: string | null;
  membershipOptOut?: boolean;
  receiptUrl?: string | null;
  companions?: string[];
  notes?: string | null;
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
  /**
   * Chains this membership covers. OMIT to leave the existing links alone; an
   * array replaces them wholesale (`[]` means "covers no chain"), so a PATCH
   * that only fixes a tier cannot unlink anything by accident.
   */
  chainIds?: number[];
  /**
   * Independent hotels this membership covers. Same rule as `chainIds`: OMIT to
   * leave them alone, an array replaces them (`[]` covers no hotel).
   */
  lodgingIds?: string[];
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
  /**
   * Which provider answered — `GET /lodging/fx-preview` has always sent it;
   * the type used to drop it, so the editor could not tell an ECB rate from a
   * CDN one and called both "EZB".
   */
  source: FxRateSource;
}

/** The providers a stored or previewed rate can come from. */
export type FxRateSource = "ecb" | "cdn" | "manual";

/**
 * Shape of `GET /api/v1/lodging-chains/:id` (routes/lodgingChains.ts). The
 * membership is found through the LINK table (`LodgingMembershipChain`), not
 * by comparing `chain.loyaltyProgram` to the membership's `programName` —
 * loyalty programmes get rebranded, and that string join broke the moment
 * either side was corrected.
 */
export interface LodgingChainStats {
  hotelCount: number;
  stayCount: number;
  nights: number;
  totalSpendBase: number;
  avgRating: number | null;
}

export interface LodgingChainDetail {
  chain: LodgingChain;
  /** The caller's own lodgings in this chain, with the same derived aggregates as the `/lodging` list. */
  lodgings: Lodging[];
  stats: LodgingChainStats;
  /** The caller's membership LINKED to this chain, if any. */
  membership: LodgingMembership | null;
  /**
   * The other chains this membership covers — taken from the membership when
   * there is one, otherwise from the catalogue suggestion. Excludes this chain.
   */
  siblingChains: LodgingChainRef[];
  /**
   * What the CATALOGUE suggests a membership here should cover: this chain plus
   * every chain seeded with the same `loyaltyProgram`. Pre-ticks the boxes when
   * creating; never consulted afterwards.
   */
  suggestedChains: LodgingChainRef[];
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
  /**
   * Sum of totalPriceBase, but ONLY for stays whose FX snapshot matches the
   * user's CURRENT base currency — see `spendBaseByCurrency` for the rest.
   */
  spendBaseTotal: number;
  /** Original amounts grouped by their original currency — not a conversion. */
  spendByCurrency: Record<string, number>;
  /** Every totalPriceBase amount grouped by the currency it was snapshotted into — includes the current-base slice that also makes up spendBaseTotal. */
  spendBaseByCurrency: Record<string, number>;
  awardNights: number;
  /** Nights broken down by lodging type (hotel/campsite/guesthouse/apartment/hostel/…). A type with zero nights has no key at all. */
  nightsByType: Record<string, number>;
  avgRatingOverall: number | null;
  chainLoyaltyMax: number;
  sameHotelRepeatMax: number;
}
