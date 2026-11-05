import { api } from "./client";

/**
 * TravTrack's fixed places (contract: docs/superpowers/specs/
 * 2026-11-05-travtrack-fixed-places.md, phase S2). Everything inside a place's
 * radius shows as one stop; the stored points stay. Home has ONE source — the
 * residence — so only its radius and window are written here.
 */

export type FixedPlaceKind = "home" | "work" | "custom";

export interface PlaceWindow {
  /** 1 = Monday … 7 = Sunday, at least one. */
  days: number[];
  from: string;
  until: string;
}

export interface FixedPlace {
  /** "home" for the home entry, a uuid otherwise. */
  id: string;
  name: string;
  kind: FixedPlaceKind;
  lat: number | null;
  lon: number | null;
  radiusM: number;
  window: PlaceWindow | null;
}

export interface LodgingAsPlace {
  enabled: boolean;
  radiusM: number;
}

export interface FixedPlacesAnswer {
  places: FixedPlace[];
  lodgingAsPlace: LodgingAsPlace;
  /** Current and upcoming bookings without coordinates; absent on an older server. */
  lodgingSkipped?: number;
}

export interface FixedPlaceInput {
  name: string;
  kind: "work" | "custom";
  lat: number;
  lon: number;
  radiusM: number;
  window: PlaceWindow | null;
}

export const PLACE_RADIUS_MIN = 25;
export const PLACE_RADIUS_MAX = 2000;

export const travTrackPlacesApi = {
  list: async (): Promise<FixedPlacesAnswer> =>
    (await api.get<FixedPlacesAnswer>("/travtrack/places")).data,
  create: async (input: FixedPlaceInput): Promise<FixedPlace> =>
    (await api.post<FixedPlace>("/travtrack/places", input)).data,
  update: async (
    id: string,
    input: FixedPlaceInput | { radiusM: number; window: PlaceWindow | null }
  ): Promise<FixedPlace> =>
    (await api.put<FixedPlace>(`/travtrack/places/${encodeURIComponent(id)}`, input)).data,
  remove: async (id: string): Promise<void> => {
    await api.delete(`/travtrack/places/${encodeURIComponent(id)}`);
  },
  setLodging: async (input: LodgingAsPlace): Promise<LodgingAsPlace> =>
    (await api.put<LodgingAsPlace>("/travtrack/places/lodging", input)).data,
};

/** How a places call failed, as the page words it. */
export type PlacesFailure = "notFound" | "disabled" | "validation" | "network" | "generic";

/**
 * Sorted by status and the server's words, never its prose: 403 with
 * `TRAVTRACK_DISABLED` (or the contract's `travtrackDisabled`) is the area
 * being off; 400 carries `error: validation | homeIsDerived`; 404 is an unknown
 * id (`TRAVTRACK_PLACE_NOT_FOUND`) or, on the list, a server without places.
 */
export function placesFailure(err: unknown): PlacesFailure {
  const response = (
    err as { response?: { status?: number; data?: { error?: unknown; code?: unknown } } } | null
  )?.response;
  if (!response) return "network";
  const error = response.data?.error;
  const code = response.data?.code;
  if (response.status === 403 && (code === "TRAVTRACK_DISABLED" || error === "travtrackDisabled"))
    return "disabled";
  if (response.status === 400) return "validation";
  if (response.status === 404) return "notFound";
  return "generic";
}
