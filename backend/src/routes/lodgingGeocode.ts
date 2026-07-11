import * as geo from "../services/geo/nominatim";

export interface AddressFields {
  address?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface AddressWithCoords extends AddressFields {
  lat?: number | null;
  lon?: number | null;
}

/**
 * PATCH-time geocode decision, extracted out of routes/lodging.ts to keep
 * that file within the project's file-size guideline.
 *
 * Only re-geocodes when address/city/country actually changed relative to
 * the existing row — an unrelated edit (e.g. notes) must not hammer
 * Nominatim for nothing. When it does re-geocode, `input.lat`/`input.lon`
 * are deliberately NOT backfilled from `existing`: those coordinates were
 * resolved for the OLD address and are now stale, so only an explicit
 * lat/lon supplied in THIS request should short-circuit the re-geocode
 * (`geo.resolveCoordinates`'s own "caller's pin wins" rule).
 *
 * Returns `null` — meaning "leave coordinates untouched" — both when
 * nothing address-related changed and when the geocode itself found
 * nothing; the caller must never let a `null` here wipe out coordinates
 * the row already had.
 */
export async function resolveUpdatedCoordinates(
  input: AddressWithCoords,
  existing: AddressFields,
): Promise<geo.Coordinates | null> {
  const addressChanged =
    (input.address !== undefined && input.address !== existing.address) ||
    (input.city !== undefined && input.city !== existing.city) ||
    (input.country !== undefined && input.country !== existing.country);
  if (!addressChanged) return null;

  return geo.resolveCoordinates({
    lat: input.lat ?? null,
    lon: input.lon ?? null,
    // `??` would treat an explicit `null` (the user clearing the field) the
    // same as "not sent", silently falling back to the STALE existing value
    // — exactly the bug finding 4 flags for the stay/lodging PATCH handlers.
    // Only an omitted key (undefined) should fall back; an explicit null
    // must reach the geocoder as-is.
    address: input.address !== undefined ? input.address : existing.address,
    city: input.city !== undefined ? input.city : existing.city,
    country: input.country !== undefined ? input.country : existing.country,
  });
}
