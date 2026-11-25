import type {
  RoadtripPreview,
  PreviewLeg,
  PreviewStation,
} from "../../../lib/api/travtrackRoadtrip";
import type { CreateRoadtripInput, StationInput } from "../../../types/roadtrip";

/**
 * The editable state of "Als Roadtrip übernehmen" (rc46 extras, part A):
 * the preview's stations, some dropped, some renamed, and the legs that join
 * the ones kept. Dropping a station joins the two legs beside it into one —
 * the line still runs through where it was, it only stops being a station.
 */

export const MAX_DRAWN_WAYPOINTS = 256;

export interface DraftStation extends PreviewStation {
  title: string;
}

export interface RoadtripDraft {
  stations: DraftStation[];
  legs: PreviewLeg[];
}

export function draftOf(
  preview: RoadtripPreview,
  fallbackName: (n: number) => string
): RoadtripDraft {
  return {
    stations: preview.stations.map((s, i) => ({ ...s, title: s.name ?? fallbackName(i + 1) })),
    legs: preview.legs,
  };
}

/** Even thinning that keeps both ends; the server already simplified each leg. */
export function thin(points: [number, number][], cap: number): [number, number][] {
  if (points.length <= cap) return points;
  const step = (points.length - 1) / (cap - 1);
  return Array.from({ length: cap }, (_, i) => points[Math.round(i * step)]);
}

function join(a: PreviewLeg, b: PreviewLeg): PreviewLeg {
  return {
    fromKey: a.fromKey,
    toKey: b.toKey,
    coordinates: thin([...a.coordinates, ...b.coordinates.slice(1)], MAX_DRAWN_WAYPOINTS),
    estimated: [...a.estimated, ...b.estimated],
    distanceKm: a.distanceKm + b.distanceKm,
    estimatedKm: a.estimatedKm + b.estimatedKm,
  };
}

/** Drop a station; the first and the last cannot go (a roadtrip needs both ends). */
export function dropStation(draft: RoadtripDraft, key: string): RoadtripDraft {
  const i = draft.stations.findIndex((s) => s.key === key);
  if (i <= 0 || i >= draft.stations.length - 1) return draft;
  const into = draft.legs.findIndex((l) => l.toKey === key);
  const out = draft.legs.findIndex((l) => l.fromKey === key);
  if (into < 0 || out < 0) return draft;
  const legs = [
    ...draft.legs.slice(0, into),
    join(draft.legs[into], draft.legs[out]),
    ...draft.legs.slice(out + 1),
  ];
  return { stations: draft.stations.filter((s) => s.key !== key), legs };
}

export function renameStation(draft: RoadtripDraft, key: string, title: string): RoadtripDraft {
  return { ...draft, stations: draft.stations.map((s) => (s.key === key ? { ...s, title } : s)) };
}

export const draftDistanceKm = (d: RoadtripDraft) => d.legs.reduce((n, l) => n + l.distanceKm, 0);
export const draftEstimatedKm = (d: RoadtripDraft) => d.legs.reduce((n, l) => n + l.estimatedKm, 0);

/** The day a station is dated by, on the account's clock. */
export function stationInputs(draft: RoadtripDraft, dayOf: (ms: number) => string): StationInput[] {
  return draft.stations.map((s) => {
    const arrive = s.arriveMs ?? s.departMs;
    const depart = s.departMs ?? s.arriveMs;
    return {
      title: s.title.trim(),
      lat: s.lat,
      lon: s.lon,
      startDate: arrive !== null ? dayOf(arrive) : null,
      endDate: depart !== null ? dayOf(depart) : null,
      night: { kind: "pass", placeId: s.placeId },
    };
  });
}

/** Which step of the save failed: the roadtrip is removed again when a later step fails. */
export type SaveStep = "create" | "stations" | "line";

export class RoadtripSaveError extends Error {
  constructor(
    readonly step: SaveStep,
    readonly cause: unknown,
    /** False when the half-made roadtrip could not be removed again (it then stays, named). */
    readonly rolledBack: boolean,
    readonly roadtripId: string | null
  ) {
    super(`Saving the roadtrip failed at ${step}`);
    this.name = "RoadtripSaveError";
  }
}

export interface RoadtripSaveApis {
  create: (input: CreateRoadtripInput) => Promise<{ id: string }>;
  replaceStations: (
    id: string,
    stations: StationInput[]
  ) => Promise<{ stations: { id: string }[] }>;
  setDrawnLeg: (
    id: string,
    from: string,
    to: string,
    waypoints: [number, number][]
  ) => Promise<unknown>;
  remove: (id: string) => Promise<void>;
}

/**
 * Write the roadtrip through the existing roadtrip and tour APIs: create it
 * (with the track span it links back to), give it its stations, then give
 * each leg the recorded line as a DRAWN line — the user's own geometry,
 * which "route all" never replaces. A failure after the create removes the
 * half-made roadtrip again, so a failed save leaves nothing behind.
 */
export async function saveRoadtrip(
  draft: RoadtripDraft,
  meta: {
    name: string;
    tripId: string | null;
    trackSpan: { fromDay: string; toDay: string };
    zone: string;
  },
  apis: RoadtripSaveApis,
  dayOf: (ms: number, zone: string) => string
): Promise<string> {
  let id: string;
  try {
    id = (
      await apis.create({ name: meta.name.trim(), tripId: meta.tripId, trackSpan: meta.trackSpan })
    ).id;
  } catch (error) {
    throw new RoadtripSaveError("create", error, true, null);
  }
  let step: SaveStep = "stations";
  try {
    const { stations } = await apis.replaceStations(
      id,
      stationInputs(draft, (ms) => dayOf(ms, meta.zone))
    );
    step = "line";
    for (let i = 1; i < stations.length; i++) {
      await apis.setDrawnLeg(id, stations[i - 1].id, stations[i].id, draft.legs[i - 1].coordinates);
    }
    return id;
  } catch (error) {
    let rolledBack = true;
    try {
      await apis.remove(id);
    } catch {
      rolledBack = false;
    }
    throw new RoadtripSaveError(step, error, rolledBack, rolledBack ? null : id);
  }
}
