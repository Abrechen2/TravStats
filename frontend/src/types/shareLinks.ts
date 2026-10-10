import type { LocalDateValue, TimeValue } from "../shared/time";

/**
 * Public share links (forgejo#281) — the wire shapes of `/api/v1/share-links`.
 * Mirrors `backend/src/schemas/shareLinks.ts`; a member of a view is absent
 * when the owner did not choose that field.
 */

export type ShareLinkKind = "flight" | "trip" | "wrapped";

/** The allow-list per kind — the only things an owner can choose to show. */
export const SHARE_LINK_FIELDS = {
  flight: ["owner", "flightNumber", "route", "schedule", "progress", "aircraft", "lastPosition"],
  trip: ["owner", "name", "dates", "totals", "countries", "route", "costs", "companions", "photos"],
  wrapped: ["owner", "totals", "topAirline", "topRoute"],
} as const satisfies Record<ShareLinkKind, readonly string[]>;

export type ShareLinkField = (typeof SHARE_LINK_FIELDS)[ShareLinkKind][number];

/** What the owner picks first: enough to say something, nothing private. */
export const SHARE_LINK_DEFAULT_FIELDS: Record<ShareLinkKind, readonly ShareLinkField[]> = {
  flight: ["flightNumber", "route", "progress"],
  trip: ["name", "dates", "totals"],
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

export interface FlightShareView {
  owner?: string | null;
  flightNumber?: { airline: string | null; number: string | null };
  route?: { from: Airport; to: Airport };
  schedule?: { departure: TimeValue | null; arrival: TimeValue | null };
  progress?: {
    phase: "scheduled" | "inFlight" | "landed" | "cancelled" | "unknown";
    fraction: number | null;
    eta: TimeValue | null;
    basis: "schedule" | "reported";
  };
  aircraft?: string | null;
  lastPosition?: { lat: number; lon: number; recordedAt: string } | null;
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
    countries: number;
    days: number | null;
  };
  countries?: string[];
  route?: Array<{ mode: "flight" | "rail" | "cruise"; from: string | null; to: string | null }>;
  costs?: { byCurrency: Array<{ currency: string; amount: number }>; complete: boolean } | null;
  companions?: string[];
  photos?: { count: number };
}

export interface WrappedShareView {
  owner?: string | null;
  year: number;
  totals?: {
    flights: number;
    distanceKm: number;
    earthFactor: number;
    newCountries: number;
    cruises: number | null;
    railRides: number | null;
    railKm: number | null;
  };
  topAirline?: { name: string; code: string | null; flights: number } | null;
  topRoute?: { from: string; to: string; flights: number } | null;
}

export type ShareView =
  | { kind: "flight"; flight: FlightShareView }
  | { kind: "trip"; trip: TripShareView }
  | { kind: "wrapped"; wrapped: WrappedShareView };

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
