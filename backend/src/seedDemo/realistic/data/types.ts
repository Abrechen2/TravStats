import type { Anchor } from "../time";
import type { LodgingKey } from "./lodgings";
import type { StationKey } from "./stations";

/**
 * The vocabulary one demo trip is written in. Every date is a DAY OFFSET from
 * the trip's first day, and every clock is the local clock where it was read,
 * so a trip is the same trip in whichever year the seed runs.
 */

export type SeatClass = "economy" | "premium_economy" | "business" | "first";

export interface SpecialFlightSpec {
  type: "sightseeing" | "aurora" | "eclipse" | "zerog";
  eventLat: number;
  eventLon: number;
  eventLabel: string;
  data?: Record<string, string | number | boolean>;
}

export interface FlightSpec {
  /** Day offset of the departure, local date at the departure airport. */
  d: number;
  /** Marketing flight number with its IATA prefix, `LH 454`; null for a flight that had none. */
  no: string | null;
  /** The operator, for a flight without a scheduled number (a sightseeing flight). */
  airline?: string;
  from: string;
  to: string;
  /** Local clocks; an arrival on a later day is written `+1 06:40`. */
  dep: string;
  arr: string;
  aircraft: string;
  reg?: string;
  seat?: string;
  cls?: SeatClass;
  /** Arrival delay in minutes, when it was noted. Absent means unknown — never 0. */
  delay?: number;
  /** Ticket price in EUR for this leg (a share of the fare for a connection). */
  price?: number;
  status?: "cancelled";
  notes?: string;
  terminal?: string;
  gate?: string;
  operatedBy?: string;
  special?: SpecialFlightSpec;
}

export interface RailSpec {
  d: number;
  operator: string;
  category: string;
  number: string;
  from: StationKey;
  to: StationKey;
  dep: string;
  arr: string;
  cls: "first" | "second" | "sleeper" | "couchette";
  price?: number;
  currency?: string;
  delay?: number;
  coach?: string;
  seat?: string;
  notes?: string;
}

export type Board = "none" | "breakfast" | "half" | "full" | "all_inclusive";

export interface StaySpec {
  lodging: LodgingKey;
  /** Check-in day offset. */
  in: number;
  nights: number;
  price: number | null;
  currency: string;
  board: Board;
  /** Overall rating, 1–5; absent when not rated. */
  rating?: number;
  room?: string;
  /** Loyalty programme (by programme name) the stay was credited to. */
  loyalty?: string;
  award?: boolean;
  notes?: string;
}

export type PlaceCategory =
  | "restaurant"
  | "landmark"
  | "nature"
  | "museum"
  | "entertainment"
  | "shopping"
  | "viewpoint"
  | "other";

export interface PlaceSpec {
  name: string;
  category: PlaceCategory;
  lat: number;
  lon: number;
  city: string;
  country: string;
  iso: string;
  /** Day offset of the visit; `null` for a place only put on a list. */
  d: number | null;
  rating?: number;
  curated?: string;
  notes?: string;
}

export type CruiseStopSpec =
  { locode: string; note?: string } | { atSea: true } | { unresolved: string; note?: string };

export interface CruiseSpec {
  /** A ship from the catalogue by name, or a ship the catalogue does not carry. */
  ship: { catalogue: string } | { override: string; line: string };
  /** Day offset of embarkation. */
  d: number;
  embark: string;
  disembark: string;
  /** One entry per day of the cruise; entry `i` is day `i + 1`. */
  stops: readonly CruiseStopSpec[];
  cabinType: "inside" | "oceanview" | "balcony" | "suite";
  cabin: string;
  deck: number;
  price: number;
  bookingReference: string;
  notes?: string;
}

export interface JournalSpec {
  d: number;
  title: string;
  body: string;
  mood?: string;
  weather?: string;
}

export interface TripTourRef {
  tour: string;
  /** Index of the roadtrip station the day tour set out from. */
  anchorStation?: number;
}

export interface TripSpec {
  key: string;
  name: string;
  anchor: Anchor;
  /** Length in days, first and last day included. */
  days: number;
  category: "vacation" | "business" | "weekend" | "family" | "other";
  color: string;
  icon: string;
  origin: string;
  destination: string;
  description?: string;
  companions?: readonly string[];
  tags?: readonly string[];
  notes?: string;
  flights?: readonly FlightSpec[];
  rail?: readonly RailSpec[];
  stays?: readonly StaySpec[];
  places?: readonly PlaceSpec[];
  cruise?: CruiseSpec;
  roadtrip?: string;
  tours?: readonly TripTourRef[];
  journal?: readonly JournalSpec[];
  /**
   * Left out of any trip on purpose, so the inbox has a suggestion to show:
   * its entries are written, the trip row is not.
   */
  ungrouped?: boolean;
}
