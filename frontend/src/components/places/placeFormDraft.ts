import type { PlaceCategory } from "../../shared/placeCategories";
import type { Place, PlaceInput } from "../../types/place";

/**
 * The place form's draft as plain data — what the dirty guard compares and
 * what the save sends. ONE function builds the starting values for both the
 * `useState` starts and the guard's baseline: if the two drifted (a note as ""
 * here and as null there) every edit form would open already "changed".
 */
export interface PlaceFormFields {
  name: string;
  /** The name on the sign, in the place's own script (forgejo#199). */
  localName: string;
  category: PlaceCategory;
  lat: number | null;
  lon: number | null;
  address: string;
  city: string;
  country: string;
  notes: string;
  visited: boolean;
  /** Provenance the picker mints; never typed (see the form). */
  externalRef: string;
}

/**
 * What the form starts with: the stored place, or an empty wishlist entry.
 * `initialName` is the text a list search found nothing for (forgejo#230) —
 * the place the user was looking for, so they need not type it twice.
 */
export function placeFormFields(place: Place | null, initialName = ""): PlaceFormFields {
  return {
    name: place?.name ?? initialName,
    localName: place?.localName ?? "",
    category: place?.category ?? "other",
    lat: place?.lat ?? null,
    lon: place?.lon ?? null,
    address: place?.address ?? "",
    city: place?.city ?? "",
    country: place?.country ?? "",
    notes: place?.notes ?? "",
    visited: place?.visited ?? false,
    externalRef: place?.externalRef ?? "",
  };
}

/**
 * The request body. Empty text is `null`, not left out: on an edit that clears
 * the stored value, and on create an empty second name lets the server split a
 * name typed with both scripts. Null when there is no position yet — the form
 * never sends without one.
 */
export function placePayload(fields: PlaceFormFields): PlaceInput | null {
  if (fields.lat === null || fields.lon === null) return null;
  const orNull = (v: string): string | null => v.trim() || null;
  return {
    name: fields.name.trim(),
    localName: orNull(fields.localName),
    category: fields.category,
    lat: fields.lat,
    lon: fields.lon,
    address: orNull(fields.address),
    city: orNull(fields.city),
    country: orNull(fields.country),
    notes: orNull(fields.notes),
    visited: fields.visited,
    externalRef: orNull(fields.externalRef),
  };
}

/**
 * The server's own length limits (`backend/src/schemas/place.ts`), held at the
 * field with `maxLength` so a too-long value can never come back as the form's
 * one generic "invalid" sentence that names no field.
 */
export const PLACE_FIELD_MAX = {
  name: 200,
  localName: 200,
  address: 300,
  city: 120,
  country: 120,
  notes: 5000,
} as const;
