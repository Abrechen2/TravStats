/**
 * The train-number lookup's vocabulary (spec 2026-09-25-rail-domain, "Lookup
 * by train number and date").
 */
export const RAIL_LOOKUP_PROVIDERS = ["transitous", "db-rest"] as const;
export type RailLookupProvider = (typeof RAIL_LOOKUP_PROVIDERS)[number];

/**
 * What one provider did with a query. Kept per provider so the UI can say
 * WHY nothing came back — "no such train that day" is a different message
 * from "the service did not answer" and from "switched off by the admin".
 */
export const RAIL_LOOKUP_OUTCOMES = [
  "matched",
  "noMatch",
  "unavailable",
  "disabled",
  "notApplicable",
] as const;
export type RailLookupOutcome = (typeof RAIL_LOOKUP_OUTCOMES)[number];

export interface RailLookupQuery {
  /** Digits only — "578" out of "ICE 578". */
  number: string;
  /** "ICE", upper case, when the user named one; narrows a number shared by two operators. */
  category: string | null;
  /** The travel day, YYYY-MM-DD, read on the boarding station's clock. */
  date: string;
  /** The boarding station. */
  from: { lat: number; lon: number; dbId: string | null };
  /** The boarding station's IANA zone; null means "read the day in UTC". */
  timezone: string | null;
}

export interface ProviderStop {
  name: string;
  lat: number;
  lon: number;
  plannedArrival: Date | null;
  plannedDeparture: Date | null;
}

/** One provider's answer: the whole trip, and where the user boards it. */
export interface ProviderTrip {
  provider: RailLookupProvider;
  /** The provider's id for the trip — stored as `lookupRef`. */
  ref: string;
  operator: string | null;
  category: string | null;
  number: string | null;
  stops: ProviderStop[];
  /** Index into `stops` of the stop nearest the boarding station. */
  boardingIndex: number;
  /** Whether the provider traces this trip's line (Transitous only). */
  hasGeometry: boolean;
}

export type ProviderResult =
  { outcome: "matched"; trip: ProviderTrip } | { outcome: Exclude<RailLookupOutcome, "matched"> };
