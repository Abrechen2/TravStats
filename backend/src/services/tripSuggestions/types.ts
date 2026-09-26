/**
 * The shapes the trip-suggestion engine passes between its stages.
 *
 * Loaders (`load.ts`) turn every domain's rows into `PresenceEntry` values; the
 * pure stages (`absences.ts`, `proposals.ts`, `placeVisits.ts`) never see a
 * Prisma row, which is what lets the cross-domain scenarios be tested without
 * a database.
 */

/** Domains whose rows can be linked to a trip by accepting a proposal. */
export type LinkableDomain = "flight" | "rail" | "cruise" | "lodging" | "place" | "roadtrip";

/**
 * Every domain that says where the user was. A standalone tour and an accepted
 * photo journey locate the user but cannot be linked: a tour's points belong to
 * the tour (the tour API refuses to move one onto a trip), and a photo journey
 * is an answer, not an entry.
 */
export type PresenceDomain = LinkableDomain | "tour" | "photo";

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
