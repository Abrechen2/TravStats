import type { Place } from "./place";

// Frontend view of place lists and the shipped checklists. Mirrors
// backend/prisma/schema.prisma (`PlaceList`, `PlaceListEntry`, `CuratedList`,
// `CuratedPlace`, `PlaceVisitPhoto`) and the routes under
// backend/src/routes/placeLists*. Hand-mirrored literal types, the same
// convention types/place.ts and types/lodging.ts already follow.
//
// Dates cross the wire as ISO strings, never `Date` objects.

/**
 * The place as it appears INSIDE a list entry.
 *
 * The list endpoint strips `visits` and the derived visit aggregates: it loads
 * them only to apply the counting rule and then drops them, because a list page
 * showing thirty places has no use for every visit row of each. Modelled as an
 * Omit rather than a fresh interface so a new `Place` field cannot silently go
 * missing here.
 */
export type PlaceListPlace = Omit<
  Place,
  "visits" | "visitCount" | "plannedVisitCount" | "lastVisitAt"
>;

export interface PlaceListEntry {
  id: string;
  listId: string;
  placeId: string;
  sortIdx: number;
  createdAt: string;
  place: PlaceListPlace;
}

export interface PlaceList {
  id: string;
  name: string;
  description: string | null;
  /** Hex. What `list` colour mode resolves a pin through. */
  color: string;
  icon: string | null;
  sortIdx: number;
  /**
   * Non-null when this list is a SUBSCRIPTION to a shipped checklist. Then the
   * name and the membership come from the catalog and the server refuses to
   * change either — colour and icon stay the user's.
   */
  curatedKey: string | null;
  createdAt: string;
  updatedAt: string;

  // ---- server-derived, never stored ----
  /** Rows in the list, wishlist entries included. */
  placeCount: number;
  /** Of those, the ones that actually happened — the future-date rule applies. */
  visitedCount: number;
  countryCount: number;
  /** Present only on the single-list responses and after a mutation. */
  entries?: PlaceListEntry[];
}

export interface PlaceListInput {
  name: string;
  description?: string | null;
  color?: string;
  icon?: string | null;
  sortIdx?: number;
}

/** One shipped checklist as the catalog lists it. */
export interface CuratedListSummary {
  key: string;
  /** German primary. */
  name: string;
  /** English mirror, or null where the name is the same in both languages. */
  nameEn: string | null;
  description: string | null;
  descriptionEn: string | null;
  icon: string | null;
  itemCount: number;
  tickedCount: number;
  subscribed: boolean;
  /** The user's `PlaceList` id for this checklist, or null when not subscribed. */
  listId: string | null;
  color: string | null;
}

/**
 * One row on the progress screen — the one screen in the app that renders two
 * kinds of row. `ticked: false` is a GHOST: a catalog target, not yet a place.
 */
export interface CuratedProgressItem {
  itemId: string;
  name: string;
  nameEn: string | null;
  lat: number;
  lon: number;
  country: string | null;
  isoCountryCode: string | null;
  blurb: string | null;
  blurbEn: string | null;
  ticked: boolean;
  /** The real `Place` behind a ticked row; null for a ghost. */
  placeId: string | null;
  lastVisitAt: string | null;
}

export interface CuratedProgress {
  key: string;
  name: string;
  nameEn: string | null;
  description: string | null;
  descriptionEn: string | null;
  icon: string | null;
  subscribed: boolean;
  listId: string | null;
  color: string | null;
  itemCount: number;
  tickedCount: number;
  items: CuratedProgressItem[];
}

export interface PlaceVisitPhoto {
  id: string;
  /** Server-built path — always use this, never rebuild it from the id. */
  url: string;
  caption: string | null;
  sortIdx: number;
  mimetype: string;
  sizeBytes: number;
  immichAssetId: string | null;
  createdAt: string;
}
