/**
 * One saved Google Maps place, looked up by the CID in its link (#358).
 *
 * The CID is Google's id for EXACTLY the place the user saved, so this is the
 * one lookup that cannot land on a namesake: measured on a real 350-row
 * Takeout export, 322 rows resolved exactly this way. It uses the Place
 * Details endpoint, which answers a `cid` parameter, with the instance's Google
 * Places key (`getApiKey("googlePlaces")`, the same key the lodging geocoder
 * uses).
 *
 * Unlike `googlePlaces.ts` this answers with a REASON on every failure rather
 * than null: the import preview must be able to say "the key was refused" or
 * "quota exhausted" — a silent empty cell is the defect the project's failure
 * rule names. Never throws, never logs the key or the response body.
 */
import { z } from "zod";
import logger from "../../../utils/logger";
import type { PositionReason } from "../../../schemas/placeImportResolve";
import { cidOfRef } from "../placeRefs";

const ENDPOINT = "https://maps.googleapis.com/maps/api/place/details/json";

/** Hard deadline per row. A preview may wait, but not on one stalled request. */
export const CID_TIMEOUT_MS = 8_000;

const responseSchema = z.object({
  status: z.string(),
  result: z
    .object({
      name: z.string().optional(),
      types: z.array(z.string()).optional(),
      formatted_address: z.string().optional(),
      geometry: z.object({ location: z.object({ lat: z.number(), lng: z.number() }) }),
      address_components: z
        .array(
          z.object({
            long_name: z.string(),
            short_name: z.string().optional(),
            types: z.array(z.string()),
          })
        )
        .optional(),
    })
    .optional(),
});

export interface CidPlace {
  lat: number;
  lon: number;
  name: string | null;
  types: string[];
  address: string | null;
  city: string | null;
  country: string | null;
  /** ISO 3166-1 alpha-2. */
  countryCode: string | null;
}

export type CidLookup = { ok: true; place: CidPlace } | { ok: false; reason: PositionReason };

/**
 * The decimal CID a row's reference names — `gmaps-cid:`, `gmaps:`, a Maps
 * link or a `?cid=` link. One parser for lookup and dedupe (`placeRefs.ts`).
 */
export const cidFromRef = cidOfRef;

/** Google's `status` field → our reason vocabulary. */
function reasonOfStatus(status: string): PositionReason {
  switch (status) {
    case "ZERO_RESULTS":
    case "NOT_FOUND":
      return "not_found";
    case "OVER_QUERY_LIMIT":
    case "OVER_DAILY_LIMIT":
      return "quota";
    case "REQUEST_DENIED":
      return "auth";
    default:
      return "provider_error";
  }
}

function reasonOfHttp(status: number): PositionReason {
  if (status === 429) return "quota";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  return "provider_error";
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export async function lookupPlaceByCid(
  cid: string,
  key: string,
  fetchImpl: typeof fetch = fetch
): Promise<CidLookup> {
  const params = new URLSearchParams({
    cid,
    // Billing-relevant: ask for exactly what the preview shows.
    fields: "name,geometry,types,formatted_address,address_components",
    // German first, as everywhere: Google otherwise answers in the local
    // language, and a Tokyo address in kanji helps no German reader.
    language: "de",
    key,
  });
  try {
    const res = await fetchImpl(`${ENDPOINT}?${params.toString()}`, {
      signal: AbortSignal.timeout(CID_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn(
        { operation: "takeout_cid_non_ok", status: res.status },
        "Google Place Details by CID non-OK"
      );
      return { ok: false, reason: reasonOfHttp(res.status) };
    }
    const parsed = responseSchema.safeParse(await res.json());
    if (!parsed.success) return { ok: false, reason: "provider_error" };
    const { status, result } = parsed.data;
    if (status !== "OK" || !result) return { ok: false, reason: reasonOfStatus(status) };

    const component = (wanted: string): { long: string; short: string | null } | null => {
      const c = result.address_components?.find((x) => x.types.includes(wanted));
      return c ? { long: c.long_name, short: c.short_name ?? null } : null;
    };
    const countryPart = component("country");
    return {
      ok: true,
      place: {
        lat: result.geometry.location.lat,
        lon: result.geometry.location.lng,
        name: result.name ?? null,
        types: result.types ?? [],
        address: result.formatted_address ?? null,
        city:
          component("locality")?.long ??
          component("postal_town")?.long ??
          component("administrative_area_level_2")?.long ??
          null,
        country: countryPart?.long ?? null,
        countryCode: countryPart?.short?.toUpperCase() ?? null,
      },
    };
  } catch (error) {
    const reason: PositionReason = isTimeout(error) ? "timeout" : "network";
    logger.warn({ operation: "takeout_cid_failed", reason }, "Google Place Details by CID failed");
    return { ok: false, reason };
  }
}
