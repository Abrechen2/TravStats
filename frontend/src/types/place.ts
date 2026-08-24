import type { PlaceCategory } from "../shared/placeCategories";
import type { PlaceVisitPhoto } from "./placeList";

// Frontend view of the `poi` domain (Places). Mirrors
// backend/prisma/schema.prisma (`Place`, `PlaceVisit`) and
// backend/src/schemas/place.ts. Hand-mirrored literal types rather than a
// cross-package import — the same convention types/lodging.ts and
// types/cruise.ts already follow.
//
// Dates cross the wire as ISO strings, never `Date` objects.

export interface PlaceVisit {
  id: string;
  placeId: string;
  tripId: string | null;
  /** ISO string, or null for a visit the user cannot date — which still counts. */
  visitedAt: string | null;
  orderIdx: number;
  notes: string | null;
  rating: number | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Photo proof. Present on the DETAIL response only — the list endpoint omits
   * it deliberately, because a gallery per row is a page of joins nobody asked
   * for. Optional here rather than in a second type so a detail payload and a
   * list payload stay the same shape everywhere else.
   */
  photos?: PlaceVisitPhoto[];
}

export interface Place {
  id: string;
  name: string;
  category: PlaceCategory;
  /** Always present — a place that cannot be drawn is not creatable. */
  lat: number;
  lon: number;
  address: string | null;
  city: string | null;
  /** Free text as the source wrote it. Group and count on `isoCountryCode`. */
  country: string | null;
  isoCountryCode: string | null;
  externalRef: string | null;
  curatedItemId: string | null;
  /** Logbook (`true`) or wishlist (`false`). Independent of whether visits exist. */
  visited: boolean;
  notes: string | null;
  dataSource: string | null;
  createdAt: string;
  updatedAt: string;

  visits: PlaceVisit[];

  // ---- server-derived, never stored ----
  /** Visits that have actually happened — future-dated ones excluded. */
  visitCount: number;
  /** Visits still in the future. Shown separately, counted nowhere. */
  plannedVisitCount: number;
  /** Most recent completed visit, or null when undated / never visited. */
  lastVisitAt: string | null;
  /**
   * Resolved by the SERVER from the country code, coordinates as the fallback.
   * One of the seven `Continent` values, or null when neither could answer.
   * Not mirrored as a union here: the client only sorts and labels it, and a
   * second copy of that vocabulary is a second thing to keep in step.
   */
  continent: string | null;
}

export interface PlaceInput {
  name: string;
  category: PlaceCategory;
  lat: number;
  lon: number;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  externalRef?: string | null;
  notes?: string | null;
  visited?: boolean;
}

export interface VisitInput {
  tripId?: string | null;
  visitedAt?: string | null;
  orderIdx?: number;
  notes?: string | null;
  rating?: number | null;
}

export type PlaceSortKey = "name" | "city" | "category" | "visitCount" | "lastVisit" | "createdAt";

export interface PlaceListQuery {
  q?: string;
  category?: PlaceCategory;
  country?: string;
  visited?: boolean;
  tripId?: string;
  sortBy?: PlaceSortKey;
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}
