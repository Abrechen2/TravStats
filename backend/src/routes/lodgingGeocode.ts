import * as geo from "../services/geo/nominatim";
import { resolveCountryCode } from "../shared/geo/countryCode";

export interface AddressFields {
  /** The lodging's own name — geocode material when there is no street address. */
  name?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface AddressWithCoords extends AddressFields {
  lat?: number | null;
  lon?: number | null;
}

/** The stored row, as far as this decision cares about it. */
export interface ExistingLodging extends AddressFields {
  lat?: number | null;
  lon?: number | null;
}

/** `undefined` means "not sent" and falls back to the stored value; an explicit `null` does not. */
function merge<T>(sent: T | undefined, stored: T | null | undefined): T | null {
  return sent !== undefined ? sent : (stored ?? null);
}

/**
 * Is there anything here that says WHERE this is?
 *
 * A name is not a location. "Hotel St. Martin" exists in Marktoberdorf, in the
 * Palatinate and in Rome, and a geocoder handed nothing but that will answer
 * with whichever one ranks first — confidently, and often wrongly. It takes a
 * street, a town or a country to turn a name into a place.
 *
 * The same mistake put a Bavarian hotel in Italy during a bulk enrichment. It
 * lived in the app too, where it turned "clear this address" into "here is a
 * different address".
 */
function hasPlaceMaterial(fields: AddressFields): boolean {
  return [fields.address, fields.city, fields.country].some(
    (value) => (value ?? "").trim().length > 0,
  );
}

/**
 * PATCH-time geocode decision, extracted out of routes/lodging.ts to keep
 * that file within the project's file-size guideline.
 *
 * Geocodes in two cases:
 *
 * 1. address/city/country actually changed relative to the existing row —
 *    the stored pin now belongs to a different place.
 * 2. the stored row has NO coordinates at all. Every input method must end
 *    up with a located hotel, and a row whose first geocode failed (or that
 *    predates geocoding entirely) used to be stuck without a pin forever:
 *    the old "only when the address changed" rule meant editing the notes,
 *    the price or the star rating never retried it. Any save is now a
 *    retry opportunity.
 *
 * An unrelated edit to an already-located row still does NOT hit Nominatim.
 *
 * When it does geocode, `input.lat`/`input.lon` are deliberately NOT
 * backfilled from `existing`: in case 1 those coordinates were resolved for
 * the OLD address and are now stale, and in case 2 there are none. Only an
 * explicit lat/lon supplied in THIS request short-circuits the geocode
 * (`geo.resolveCoordinates`'s own "caller's pin wins" rule).
 *
 * Returns `null` — meaning "leave coordinates untouched" — both when there
 * is nothing to do and when the geocode itself found nothing; the caller
 * must never let a `null` here wipe out coordinates the row already had.
 */
export async function resolveUpdatedCoordinates(
  input: AddressWithCoords,
  existing: ExistingLodging,
): Promise<geo.Coordinates | null> {
  const addressChanged =
    (input.address !== undefined && input.address !== existing.address) ||
    (input.city !== undefined && input.city !== existing.city) ||
    (input.country !== undefined && input.country !== existing.country);
  const missingCoordinates = existing.lat == null || existing.lon == null;
  if (!addressChanged && !missingCoordinates) return null;

  // What the row will actually say after this write — an explicit null clears,
  // an omitted key keeps what is stored.
  const effective = {
    address: input.address !== undefined ? input.address : existing.address,
    city: input.city !== undefined ? input.city : existing.city,
    country: input.country !== undefined ? input.country : existing.country,
  };
  // Nothing left that says where this is. Searching by the bare name here is
  // exactly how emptying an address produced a new one somewhere else.
  if (!hasPlaceMaterial(effective)) return null;

  return geo.resolveCoordinates({
    lat: input.lat ?? null,
    lon: input.lon ?? null,
    // Carries the hotel name so a lodging with no street address is still
    // findable — "Hotel Adlon Kempinski, Berlin" resolves, "Berlin" does not.
    name: merge(input.name, existing.name),
    // `??` would treat an explicit `null` (the user clearing the field) the
    // same as "not sent", silently falling back to the STALE existing value
    // — exactly the bug finding 4 flags for the stay/lodging PATCH handlers.
    // Only an omitted key (undefined) should fall back; an explicit null
    // must reach the geocoder as-is.
    ...effective,
  });
}

/** The location columns a write should apply. Absent keys mean "don't touch". */
export interface LocationPatch {
  lat?: number;
  lon?: number;
  address?: string;
  city?: string;
  country?: string;
}

/**
 * The ONE place that decides what a lodging's location columns become — used
 * by both the create and the update route so the two can never drift.
 *
 * The rule the owner set: whatever the input method, always TRY to find the
 * location and to complete it. That means both directions, because the input
 * methods point opposite ways:
 *
 *   - typed address, no pin      -> forward geocode  (address -> coordinates)
 *   - dropped pin / pasted coords -> reverse geocode (coordinates -> address)
 *
 * Neither direction ever overwrites what the user supplied: an explicit pin
 * wins over a geocode (`geo.resolveCoordinates`), and reverse geocoding only
 * fills address fields left EMPTY (`geo.completeAddressFromCoordinates`).
 * Both are non-throwing and resolve to null on failure, so a flaky geocoder
 * can delay a pin but never block or fail a save.
 *
 * Pass `existing` on update, omit it on create.
 */
export async function resolveLocation(
  input: AddressWithCoords,
  existing?: ExistingLodging,
): Promise<LocationPatch> {
  const coords = existing
    ? await resolveUpdatedCoordinates(input, existing)
    : hasPlaceMaterial(input)
      ? await geo.resolveCoordinates(input)
      : null;

  // Sending both coordinates as null is not an omission, it is "remove the
  // pin". A lookup that runs in the same write — because the address changed —
  // must not quietly put one back.
  const pinRemoved = input.lat === null && input.lon === null;

  const patch: LocationPatch = {};
  if (coords && !pinRemoved) {
    patch.lat = coords.lat;
    patch.lon = coords.lon;
  }

  // Reverse-complete against the coordinates this write will END UP with —
  // freshly geocoded, explicitly supplied, or already stored — so a pin that
  // arrived on an earlier save still gets its address filled in on this one.
  const effectiveLat = patch.lat ?? merge(input.lat, existing?.lat);
  const effectiveLon = patch.lon ?? merge(input.lon, existing?.lon);
  const completed = await geo.completeAddressFromCoordinates({
    lat: effectiveLat,
    lon: effectiveLon,
    address: merge(input.address, existing?.address),
    city: merge(input.city, existing?.city),
    country: merge(input.country, existing?.country),
  });
  // Only fields the request did not mention. A field the user explicitly
  // emptied stays empty: reverse geocoding fills gaps, it does not overrule a
  // decision. Restoring what someone just deleted — from coordinates that may
  // themselves be wrong — is how a correction becomes a new error.
  if (completed?.address && input.address === undefined) patch.address = completed.address;
  if (completed?.city && input.city === undefined) patch.city = completed.city;
  // The country may also be replaced when the value present is not a country at
  // all — a city or a state left there by a parser. A name the resolver knows
  // is left alone even if the pin disagrees: that is a conflict for the user to
  // settle, not for a reverse lookup to overrule.
  const effectiveCountry = merge(input.country, existing?.country);
  // "Present, but not a country" — a city or a state left there by a parser.
  // An EMPTY value is not that: emptying a field is a decision, and refilling
  // it from coordinates is exactly the defect 2.6.0 removed. So the replacement
  // needs a non-empty value that resolves to nothing.
  const countryIsNotACountry =
    Boolean(effectiveCountry?.trim()) && resolveCountryCode(effectiveCountry) === null;
  if (completed?.country && (input.country === undefined || countryIsNotACountry)) {
    patch.country = completed.country;
  }

  return patch;
}
