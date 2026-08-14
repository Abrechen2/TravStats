/**
 * Google Places — the LAST tier of the lodging geocode chain, and the only one
 * that is not open data.
 *
 * Why it exists at all, measured on 30 of the owner's real hotel names
 * (2026-08-14): the keyless OpenStreetMap tier answered 21 times and only 14 of
 * those answers were a place to sleep; Google answered 30 times, 27 of them a
 * lodging. The gap is not accuracy, it is COVERAGE — OSM carries streets and
 * amenities, Google carries business listings, and a hotel is a business. "JI
 * Hotel Shanghai Railway Station West Tianmu Road" finds nothing in Nominatim
 * and lands on a RAILWAY STATION in Photon.
 *
 * Off unless an admin enters a key, exactly like the FX rate CDN and the
 * premium logo tier: a self-hosted instance must work, and work well, with no
 * account anywhere. This tier buys precision for those who want it.
 *
 * Never throws — every failure path returns null, because a lodging without a
 * pin is valid data and a geocoder must never break a save or an import.
 */
import { z } from "zod";
import { getApiKey } from "../apiKeyResolver";
import logger from "../../utils/logger";
import { LODGING_TYPES } from "../../schemas/lodging";

/** The vocabulary the app stores — never Google's. */
type LodgingTypeKey = (typeof LODGING_TYPES)[number];

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

/** Hard deadline. A geocode is a background nicety; it may never hold a request open. */
const TIMEOUT_MS = 8_000;

/**
 * Google's place vocabulary → ours.
 *
 * A type that is NOT in this table is not a place to sleep, and its hit is
 * DISCARDED rather than stored. That rule is the whole point: the OSM tier
 * happily returned a charging station for "Thon Hotel Halden" and a restaurant
 * for "Hotel Restaurant Gruber" — a pin that is wrong but looks right is worse
 * than no pin at all.
 */
const PLACE_TYPE_TO_LODGING: Readonly<Record<string, LodgingTypeKey>> = {
  hotel: "hotel",
  motel: "hotel",
  inn: "hotel",
  resort_hotel: "hotel",
  extended_stay_hotel: "hotel",
  japanese_inn: "hotel",
  budget_japanese_inn: "hotel",
  lodging: "hotel",
  hostel: "hostel",
  guest_house: "guesthouse",
  bed_and_breakfast: "guesthouse",
  farmstay: "guesthouse",
  private_guest_room: "guesthouse",
  campground: "campsite",
  camping_cabin: "campsite",
  rv_park: "campsite",
  apartment_complex: "apartment",
  apartment_building: "apartment",
  serviced_apartment: "apartment",
  cottage: "apartment",
};

const responseSchema = z.object({
  places: z
    .array(
      z.object({
        displayName: z.object({ text: z.string() }).optional(),
        primaryType: z.string().optional(),
        location: z.object({ latitude: z.number(), longitude: z.number() }),
        shortFormattedAddress: z.string().optional(),
        addressComponents: z
          .array(z.object({ longText: z.string(), types: z.array(z.string()) }))
          .optional(),
      }),
    )
    .optional(),
});

export interface GooglePlaceMatch {
  lat: number;
  lon: number;
  /** What kind of place it is, in OUR vocabulary — never Google's raw string. */
  type: LodgingTypeKey;
  name: string | null;
  city: string | null;
  country: string | null;
  address: string | null;
}

/** True when an instance has a key configured — used to skip the tier entirely. */
export async function isGooglePlacesConfigured(): Promise<boolean> {
  return (await getApiKey("googlePlaces")) !== null;
}

/**
 * Look one lodging up by name (plus whatever place words are known).
 *
 * Returns null when there is no key, no match, or the best match is not a
 * lodging. The caller keeps whatever the earlier tiers found.
 */
export async function findLodgingPlace(query: string): Promise<GooglePlaceMatch | null> {
  const key = await getApiKey("googlePlaces");
  if (!key) return null;

  const trimmed = query.trim();
  if (trimmed.length < 2) return null;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        // Field mask is mandatory AND billing-relevant: asking for less is
        // cheaper, so request exactly the six fields this function returns.
        "X-Goog-FieldMask":
          "places.displayName,places.primaryType,places.location,places.shortFormattedAddress,places.addressComponents",
      },
      body: JSON.stringify({ textQuery: trimmed, maxResultCount: 1 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      // Never log the body: it is third-party content and may echo the query.
      logger.warn({ operation: "google_places_non_ok", status: res.status }, "Google Places lookup non-OK");
      return null;
    }

    const parsed = responseSchema.safeParse(await res.json());
    if (!parsed.success) {
      logger.warn({ operation: "google_places_shape" }, "Google Places answered an unexpected shape");
      return null;
    }

    const place = parsed.data.places?.[0];
    if (!place) return null;

    const type = place.primaryType ? PLACE_TYPE_TO_LODGING[place.primaryType] : undefined;
    if (!type) {
      // A real answer about something that is not a lodging — a restaurant, a
      // building, a casino. Discarding it is the point.
      logger.debug(
        { operation: "google_places_not_lodging", primaryType: place.primaryType },
        "Google Places matched something that is not a lodging",
      );
      return null;
    }

    const component = (wanted: string): string | null =>
      place.addressComponents?.find((c) => c.types.includes(wanted))?.longText ?? null;

    return {
      lat: place.location.latitude,
      lon: place.location.longitude,
      type,
      name: place.displayName?.text ?? null,
      city: component("locality") ?? component("postal_town") ?? component("administrative_area_level_2"),
      country: component("country"),
      address: place.shortFormattedAddress ?? null,
    };
  } catch (error) {
    logger.warn(
      { operation: "google_places_failed", error: error instanceof Error ? error.message : String(error) },
      "Google Places lookup failed",
    );
    return null;
  }
}
