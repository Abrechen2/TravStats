import type { LocalDateValue, TimeValue } from "../shared/time";

/**
 * Public share links (forgejo#281) — the wire shapes of `/api/v1/share-links`.
 * Mirrors `backend/src/schemas/shareLinks.ts`; a member of a view is absent
 * when the owner did not choose that field.
 */

export type ShareLinkKind = "flight" | "trip" | "wrapped" | "cruise" | "stay" | "visit";

/**
 * The kinds a link can still be made for (owner decision 2026-11-22). Old
 * flight, cruise, stay and visit links stay listed — marked `retired` — so the
 * owner can delete them; their page says "no longer available".
 */
export type CreatableShareLinkKind = "trip" | "wrapped";

/** What a trip link's itinerary can show; flights, stays and transport are the default. */
export const SHARE_LINK_ITINERARY_SECTIONS = ["flights", "stays", "transport", "places"] as const;

/**
 * The allow-list per kind — the only things an owner can choose to show. The
 * trip's `itinerary` is the pre-2026-11-22 "all sections" field, which the
 * server still accepts from installed apps; the dialog offers the sections.
 */
export const SHARE_LINK_FIELDS = {
  trip: [
    "owner",
    "name",
    "dates",
    "totals",
    "countries",
    "route",
    "photos",
    "itinerary",
    ...SHARE_LINK_ITINERARY_SECTIONS,
  ],
  wrapped: ["owner", "totals", "topAirline", "topRoute"],
} as const satisfies Record<CreatableShareLinkKind, readonly string[]>;

export type ShareLinkField = (typeof SHARE_LINK_FIELDS)[CreatableShareLinkKind][number];

/** What the owner picks first: the trip's name and days, and where to find them. */
export const SHARE_LINK_DEFAULT_FIELDS: Record<CreatableShareLinkKind, readonly ShareLinkField[]> =
  {
    trip: ["name", "dates", "flights", "stays", "transport"],
    wrapped: ["totals"],
  };

export interface ShareLink {
  id: string;
  kind: ShareLinkKind;
  targetId: string;
  fields: string[];
  expiresAt: string;
  effectiveExpiresAt: string;
  createdAt: string;
  /** A kind no longer offered: the owner can only delete it. */
  retired: boolean;
  viewCount: number;
  lastViewedAt: string | null;
}

export interface ShareLinkList {
  enabled: boolean;
  links: ShareLink[];
}

export interface CreatedShareLink {
  id: string;
  url: string;
  token: string;
  expiresAt: string;
  effectiveExpiresAt: string;
}

interface Airport {
  code: string | null;
  name: string | null;
}

type FlightPhase = "scheduled" | "inFlight" | "landed" | "cancelled" | "unknown";

/** A ride's ends and times — rail, bus and ferry share it (`service`: train, line or vessel). */
interface ItineraryRide {
  operator: string | null;
  service: string | null;
  from: string;
  to: string;
  departure: TimeValue | null;
  arrival: TimeValue | null;
}

/**
 * One entry of a trip's itinerary (forgejo#302), on its place's clock. There
 * is no member for a booking reference, seat, room or cabin number, price,
 * note, companion or id: the server has none to send.
 */
export type ItineraryItem =
  | {
      kind: "flight";
      airline: string | null;
      flightNumber: string | null;
      from: Airport;
      to: Airport;
      departure: TimeValue | null;
      arrival: TimeValue | null;
      /** Departure terminal and gate, when stored. */
      terminal: string | null;
      gate: string | null;
      phase: FlightPhase;
    }
  | {
      kind: "stay";
      name: string;
      address: string | null;
      city: string | null;
      country: string | null;
      checkIn: LocalDateValue | null;
      checkOut: LocalDateValue | null;
      checkInAt: TimeValue | null;
      checkOutAt: TimeValue | null;
    }
  | {
      kind: "cruise";
      ship: string | null;
      cruiseLine: string | null;
      start: LocalDateValue | null;
      end: LocalDateValue | null;
      ports: Array<{
        dayNumber: number;
        name: string | null;
        atSea: boolean;
        day: LocalDateValue | null;
        arrival: TimeValue | null;
        departure: TimeValue | null;
      }>;
    }
  | ({ kind: "rail" | "bus" | "ferry" } & ItineraryRide)
  | {
      kind: "rental";
      provider: string;
      pickup: { station: string; at: TimeValue | null };
      return: { station: string; at: TimeValue | null };
    }
  | { kind: "visit"; name: string; city: string | null; at: TimeValue | null }
  | { kind: "stop"; name: string; start: TimeValue | null; end: TimeValue | null };

export interface ItineraryShareView {
  sections: Array<(typeof SHARE_LINK_ITINERARY_SECTIONS)[number]>;
  items: ItineraryItem[];
  /** The entry in progress by the plan, else the next one; null when nothing is ahead. */
  now: { index: number; state: "inProgress" | "next" } | null;
}

export interface TripShareView {
  owner?: string | null;
  name?: string;
  dates?: { start: LocalDateValue | null; end: LocalDateValue | null };
  totals?: {
    flights: number;
    flightKm: number | null;
    cruises: number;
    railRides: number;
    busRides: number;
    countries: number;
    days: number | null;
  };
  countries?: string[];
  route?: Array<{
    mode: "flight" | "rail" | "bus" | "cruise";
    from: string | null;
    to: string | null;
  }>;
  photos?: { count: number };
  itinerary?: ItineraryShareView;
}

export interface WrappedShareView {
  owner?: string | null;
  year: number;
  totals?: {
    /** Null when the owner does not see flights. */
    flights: number | null;
    /** Null with `flights`, or when no flight of the year measured a distance. */
    distanceKm: number | null;
    earthFactor: number | null;
    newCountries: number;
    cruises: number | null;
    railRides: number | null;
    railKm: number | null;
  };
  topAirline?: { name: string; code: string | null; flights: number } | null;
  topRoute?: { from: string; to: string; flights: number } | null;
}

export type ShareView =
  { kind: "trip"; trip: TripShareView } | { kind: "wrapped"; wrapped: WrappedShareView };

/** Owner-only: which photos a trip link leaves out, and why (preview answer). */
export interface PhotoOmissions {
  unsupportedType: number;
  unreadable: number;
  overLimit: number;
}

export interface ShareLinkPreviewResult {
  view: ShareView;
  photosOmitted: PhotoOmissions | null;
}
