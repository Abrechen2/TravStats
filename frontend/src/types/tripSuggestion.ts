/**
 * A trip suggestion as `GET /api/v1/trip-suggestions` sends it — the shape of
 * `TripSuggestion` in `backend/src/services/tripSuggestions/types.ts`.
 */

export type TripSuggestionKind = "new_trip" | "assign" | "extend" | "place_visit";

export type TripSuggestionDomain = "flight" | "rail" | "cruise" | "lodging" | "place" | "roadtrip";

export interface TripSuggestionMember {
  /** `domain:id` — what an accept names to keep a member. */
  key: string;
  domain: TripSuggestionDomain;
  id: string;
  label: string;
  startDay: string;
  endDay: string;
  planned: boolean;
}

export interface TripSuggestion {
  id: string;
  kind: TripSuggestionKind;
  /** Local calendar days, YYYY-MM-DD. */
  startDay: string;
  endDay: string;
  nights: number | null;
  planned: boolean;
  destination: string | null;
  signals: Array<"pnr" | "home_loop" | "continuity">;
  /** Entries whose place had no known zone — their day may be one off. */
  zoneUnknown: number;
  members: TripSuggestionMember[];
  trip?: { id: string; name: string; startDay: string | null; endDay: string | null };
  newSpan?: { startDay: string; endDay: string };
  place?: { id: string; name: string };
  anchor?: { key: string; domain: TripSuggestionDomain; label: string; tripId: string | null };
  distanceM?: number;
}

/** How the server knew where home was — `missing` limits what it can propose. */
export type TripSuggestionHome = "history" | "estimated" | "missing";

export interface TripSuggestionList {
  suggestions: TripSuggestion[];
  total: number;
  home: TripSuggestionHome;
  truncated: boolean;
}

export interface TripSuggestionEdits {
  name?: string;
  startDay?: string;
  endDay?: string;
  memberKeys?: string[];
  visitDay?: string;
}

export interface TripSuggestionAccepted {
  tripId: string | null;
  placeVisitId: string | null;
  linked: number;
}
