import type {
  Board,
  FlightSpec,
  JournalSpec,
  PlaceCategory,
  PlaceSpec,
  RailSpec,
  StaySpec,
} from "./types";
import type { LodgingKey } from "./lodgings";
import type { StationKey } from "./stations";

/**
 * Terse constructors for the trip lists, so a trip reads as its itinerary and
 * not as a wall of object keys. Each returns exactly the spec it names.
 */

export const JULIA = "Julia Becker";
export const TOBIAS = "Tobias Wagner";
export const LENA = "Lena Wagner";
export const MARKUS = "Markus Klein";

export const MILES_AND_MORE = "Miles & More";
export const BONVOY = "Marriott Bonvoy";
export const ALL_ACCOR = "ALL – Accor Live Limitless";

export const fl = (
  d: number,
  no: string | null,
  from: string,
  to: string,
  dep: string,
  arr: string,
  aircraft: string,
  extra: Partial<FlightSpec> = {}
): FlightSpec => ({ d, no, from, to, dep, arr, aircraft, ...extra });

export const rail = (
  d: number,
  operator: string,
  category: string,
  number: string,
  from: StationKey,
  to: StationKey,
  dep: string,
  arr: string,
  cls: RailSpec["cls"],
  extra: Partial<RailSpec> = {}
): RailSpec => ({ d, operator, category, number, from, to, dep, arr, cls, ...extra });

export const stay = (
  lodging: LodgingKey,
  inDay: number,
  nights: number,
  price: number | null,
  currency: string,
  board: Board,
  rating?: number,
  extra: Partial<StaySpec> = {}
): StaySpec => ({ lodging, in: inDay, nights, price, currency, board, rating, ...extra });

export const place = (
  name: string,
  category: PlaceCategory,
  lat: number,
  lon: number,
  where: readonly [city: string, country: string, iso: string],
  d: number | null,
  rating?: number,
  extra: Partial<PlaceSpec> = {}
): PlaceSpec => ({
  name,
  category,
  lat,
  lon,
  city: where[0],
  country: where[1],
  iso: where[2],
  d,
  rating,
  ...extra,
});

export const note = (
  d: number,
  title: string,
  body: string,
  mood?: string,
  weather?: string
): JournalSpec => ({
  d,
  title,
  body,
  mood,
  weather,
});
