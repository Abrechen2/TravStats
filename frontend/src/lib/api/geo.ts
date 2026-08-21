import { api } from "./client";

/**
 * One normalized place-search hit — mirrors the backend envelope returned by
 * `GET /api/v1/geo/search` (`backend/src/services/geo/photon.ts`'s
 * `PlaceResult`). The backend degrades to `[]` on any geocoder failure
 * (never a 5xx for a geocoder hiccup) — a non-200 response from OUR backend
 * is a real error and surfaces as a thrown `AxiosError` here.
 */
export interface PlaceSearchResult {
  name: string;
  address?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  lat: number;
  lon: number;
  type?: string;
}

interface Envelope<T> {
  success: boolean;
  data: T;
  /** true = the geocoder itself failed; the empty list is NOT "no matches" (#263). */
  degraded?: boolean;
}

export interface PlaceSearchResponse {
  results: PlaceSearchResult[];
  degraded: boolean;
}

/**
 * Same-origin Photon place search (search-as-you-type), proxied through our
 * backend — the browser's CSP forbids fetching Photon/Nominatim directly.
 */
export const searchPlaces = async (q: string, lang?: string): Promise<PlaceSearchResponse> => {
  const params: Record<string, string> = { q };
  if (lang) params.lang = lang;
  const { data } = await api.get<Envelope<PlaceSearchResult[]>>("/geo/search", { params });
  return { results: data.data, degraded: data.degraded === true };
};

/** Address parts resolved from a picked pin — mirrors the backend's
 * `GeocodeParts` (`GET /api/v1/geo/reverse`). `null` = nothing resolved
 * (open water is not an error). */
export interface ReverseGeocodeResult {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
}

/** Coordinates → address parts, proxied through our backend (same CSP
 * rationale as `searchPlaces` — the browser may not talk to Nominatim). */
export const reverseGeocode = async (
  lat: number,
  lon: number
): Promise<ReverseGeocodeResult | null> => {
  const { data } = await api.get<Envelope<ReverseGeocodeResult | null>>("/geo/reverse", {
    params: { lat: String(lat), lon: String(lon) },
  });
  return data.data;
};
