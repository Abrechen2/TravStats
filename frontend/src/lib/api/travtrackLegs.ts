import { api } from "./client";

/**
 * Legs and stops of a TravTrack day (spec 2026-11-03-travtrack-legs, §2): the
 * day as journeys and dwells, derived by the server from the privacy-safe
 * stretches, plus the owner's mode correction. Every figure that cannot be
 * derived is `null`, never 0 — the UI shows "–".
 */

export type LegMode =
  "walk" | "run" | "cycle" | "car" | "bus" | "train" | "boat" | "flight" | "unknown";

/** The modes the owner can pick; `null` hands the leg back to the automatic one. */
export const PICKABLE_MODES = ["walk", "cycle", "car", "bus", "train", "boat"] as const;
export type PickableMode = (typeof PICKABLE_MODES)[number];

export interface TravTrackLeg {
  /** `${fromMs}-${untilMs}` — stable for the same points. */
  id: string;
  fromMs: number;
  untilMs: number;
  mode: LegMode;
  modeSource: "auto" | "entry" | "manual";
  confidence: "high" | "low";
  entryRef: { domain: string; id: string } | null;
  distanceM: number;
  durationMs: number;
  movingMs: number | null;
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
  ascentM: number | null;
  descentM: number | null;
  /** `[west, south, east, north]`. */
  bounds: [number, number, number, number];
  /** Inclusive vertex index ranges into the day's `segments`. */
  ranges: Array<{ segment: number; from: number; to: number }>;
}

export interface TravTrackStop {
  fromMs: number;
  untilMs: number;
  anchor: { lat: number; lon: number };
  /** An existing stay suggestion / lodging; null when none (or suggestions are off). */
  stayRef: { id: string; status: string } | null;
  /**
   * The stop's name: the one the owner accepted, else a fixed place or a booked
   * lodging (`fixed`/`lodging`, spec 2026-11-05-travtrack-fixed-places); null until then.
   */
  place: {
    name: string;
    lat: number | null;
    lon: number | null;
    source: "accepted" | "fixed" | "lodging";
    placeId?: string;
    lodgingStayId?: string;
  } | null;
  /** A run of fixes folded into one stop; null (or absent on an older server) when not folded. */
  folded?: { fixCount: number } | null;
}

export interface TravTrackStopCandidate {
  name: string;
  type: string | null;
  address: string | null;
  city: string | null;
  lat: number;
  lon: number;
  distanceM: number;
}

export type LookupState = "ok" | "empty" | "degraded";

/** What a stop probably was (`GET /travtrack/stops/place`). `degraded` is a failed lookup, not "nothing there". */
export interface TravTrackStopIdentity {
  lat: number;
  lon: number;
  probable: {
    name: string;
    source: "known" | "nearbyPlace" | "address" | "photos";
    photoSupported: boolean;
  } | null;
  known: Array<{
    name: string;
    kind: "place" | "lodging";
    distanceM: number;
    lat: number;
    lon: number;
  }>;
  geocoder: LookupState;
  candidates: TravTrackStopCandidate[];
  candidatesState: LookupState;
  /** `off`: stay suggestions are switched off; only the owner's own places were asked. Absent on older servers. */
  lookup?: "on" | "off";
}

export interface AcceptedStopPlace {
  name: string;
  lat?: number | null;
  lon?: number | null;
}

/** The phone's own readings of one vertex; each is null where it gave none. */
export interface TravTrackPointDetail {
  speedMps: number | null;
  altitudeM: number | null;
  motion: string | null;
}

/** A range view's totals from the stored points, not from the simplified drawing. */
export interface TravTrackAggregates {
  distanceM: number;
  movingMs: number | null;
  maxSpeedMps: number | null;
}

export const travTrackLegsApi = {
  /** `mode: null` resets to automatic. Answers the recomputed leg. */
  setMode: async (
    span: { fromMs: number; untilMs: number },
    mode: PickableMode | null
  ): Promise<TravTrackLeg> =>
    (await api.put<TravTrackLeg>("/travtrack/legs/mode", { ...span, mode })).data,
  /** What a stop probably was; asked per visible stop. */
  stopIdentity: async (stop: TravTrackStop): Promise<TravTrackStopIdentity> =>
    (
      await api.get<TravTrackStopIdentity>("/travtrack/stops/place", {
        params: {
          lat: stop.anchor.lat,
          lon: stop.anchor.lon,
          fromMs: stop.fromMs,
          untilMs: stop.untilMs,
        },
      })
    ).data,
  /** Stores the accepted name (`null` removes it). Answers the recomputed stop. */
  setStopPlace: async (
    span: { fromMs: number; untilMs: number },
    place: AcceptedStopPlace | null
  ): Promise<TravTrackStop> =>
    (await api.put<TravTrackStop>("/travtrack/stops/place", { ...span, place })).data,
};
