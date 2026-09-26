/**
 * The shapes the trip-suggestion engine passes between its stages.
 *
 * Loaders (`load.ts`) turn every domain's rows into `PresenceEntry` values; the
 * pure stages (`absences.ts`, `proposals.ts`, `placeVisits.ts`) never see a
 * Prisma row, which is what lets the cross-domain scenarios be tested without
 * a database.
 */

/**
 * Domains whose rows can be linked to a trip by accepting a proposal. A tour is
 * linkable only as a SINGLE-DAY tour with no trip yet (owner decision
 * 2026-09-26, "tours join the trip"): it joins through its own trip link, and
 * a tour already on a trip is never moved — the tour API refuses that too.
 */
export type LinkableDomain =
  "flight" | "rail" | "cruise" | "lodging" | "place" | "roadtrip" | "tour";

/**
 * Every domain that says where the user was. A multi-day tour and an accepted
 * photo journey locate the user but are never linked: a multi-day tour is a
 * journey of its own, and a photo journey is an answer, not an entry.
 */
export type PresenceDomain = LinkableDomain | "photo";

export interface Coordinate {
  lat: number;
  lon: number;
}

/** One place-and-time the user was at. */
export interface PresencePoint extends Coordinate {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  /**
   * Local hour, used ONLY to order points within a day. Timed entries (flights,
   * rides) carry their real local hour; date-only ones a conventional one — a
   * check-in at 15, a check-out at 10, a visit at noon — so a hotel check-out
   * sorts before the flight home that same day.
   */
  hour: number;
}

export interface PresenceEntry {
  /** `${domain}:${id}` — unique across domains, and what a dismissal remembers. */
  key: string;
  domain: PresenceDomain;
  id: string;
  tripId: string | null;
  linkable: boolean;
  state: "happened" | "planned";
  startDay: string;
  endDay: string;
  points: readonly PresencePoint[];
  /** Days whose FOLLOWING night this entry itself spends away (a stay, a cruise, a night train). */
  nights: readonly string[];
  /** What the user recognises: "LH 1790 MUC → LIS", "Hotel Avenida". */
  label: string;
  /** Where it went, for naming a proposal. */
  city: string | null;
  country: string | null;
  /**
   * The city of each point, aligned with `points`, where the ends of an entry
   * lie in different places (a flight, a ride). The destination is named from
   * the AWAY ends only — a return flight's arrival city is home.
   */
  pointCities?: readonly (string | null)[];
  /**
   * The place's zone was not known, so the entry's days are its UTC days and
   * may be one off (ADR 0002: flagged, never silently assumed).
   */
  zoneUnknown?: boolean;
  /** A flight's booking reference — the PNR signal. */
  pnr?: string | null;
}

/** A trip the account already has, as the engine needs it. */
export interface TripContext {
  id: string;
  name: string;
  /** The trip's own dates, when set. */
  startDay: string | null;
  endDay: string | null;
}

/** An own place, with the days it already has a visit on. */
export interface PlaceContext extends Coordinate {
  id: string;
  name: string;
  visitDays: readonly string[];
}

/** Where home was on a given day, or null when nothing says. */
export type HomeAt = (day: string) => Coordinate | null;

export type SuggestionKind = "new_trip" | "assign" | "extend" | "place_visit";

/** A clustering signal the flight heuristics contributed (`tripDetectionService`). */
export type SuggestionSignal = "pnr" | "home_loop" | "continuity";

export interface SuggestionMember {
  key: string;
  domain: LinkableDomain;
  id: string;
  label: string;
  startDay: string;
  endDay: string;
  planned: boolean;
}

export interface TripSuggestion {
  /** Stable while the proposal's content is; accepting names it. */
  id: string;
  kind: SuggestionKind;
  startDay: string;
  endDay: string;
  /** Nights away the absence holds; null for a place visit. */
  nights: number | null;
  /** Every member is still ahead — a plan, not a memory. */
  planned: boolean;
  /** The most-visited destination, for the name ("Lissabon", "Italien"). */
  destination: string | null;
  signals: SuggestionSignal[];
  /** Entries of the absence whose zone was unknown — their day may be one off. */
  zoneUnknown: number;
  members: SuggestionMember[];
  /** assign / extend: the trip the entries belong to. */
  trip?: TripContext;
  /** extend: the trip's span once the entries are in. */
  newSpan?: { startDay: string; endDay: string };
  /** place_visit: the place, what put the user there, and how close it was. */
  place?: { id: string; name: string };
  anchor?: { key: string; domain: LinkableDomain; label: string; tripId: string | null };
  distanceM?: number;
}

/** How the engine knew where home was. */
export type HomeSource = "history" | "estimated" | "missing";
