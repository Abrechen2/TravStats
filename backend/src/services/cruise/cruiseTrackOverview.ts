import { prisma } from "../../db";
import { buildEffectivePortSequence } from "../../shared/cruise/portSequence";
import {
  CRUISE_TRACK_COVERAGE_SELECT,
  resolveRecordedLegs,
  type LegTrackVerdict,
} from "../cruiseDistance/recordedLegs";
import { RECORDED_TRACK_METHOD } from "../cruiseDistance/cruiseLegService";
import type { CruiseGeometrySource } from "./cruiseGeometry";
import { cruiseLegWindow, cruiseWindow, type WindowStop } from "./cruiseLegWindow";

/**
 * What the cruise page shows about recordings: the recordings themselves
 * (without their lines) and, per leg, where its line and kilometres come from
 * and what the recordings say about it. The verdict is computed here, on the
 * server, and the page only displays it (board item
 * `tour-track-coverage-server-side`).
 */

export interface CruiseTrackMetaDto {
  id: string;
  cruiseId: string;
  source: string;
  name: string | null;
  startedAt: Date;
  endedAt: Date;
  pointCount: number;
  distanceKm: number;
  truncated: boolean;
  externalRef: string | null;
  createdAt: Date;
  /** Ordinals of the legs whose line this recording supplies. */
  coveredLegs: number[];
}

interface WindowDto {
  startAt: string;
  endAt: string;
}

export interface CruiseLegTrackDto {
  ordinal: number;
  fromPortId: number;
  toPortId: number;
  fromPortName: string;
  toPortName: string;
  /** As persisted in `cruise_legs`; null when the legs have not been computed. */
  distanceKm: number | null;
  geometrySource: CruiseGeometrySource;
  coverage: LegTrackVerdict | null;
  /** The window a Dawarich pull for this leg asks for; null without dates. */
  window: WindowDto | null;
}

export interface CruiseTrackOverview {
  tracks: CruiseTrackMetaDto[];
  legs: CruiseLegTrackDto[];
  /** The whole voyage's window, for a pull of every leg at once. */
  window: WindowDto | null;
}

/**
 * Persisted distance method → map source label. `haversine` is the chain's
 * straight-line fallback; every other calculator follows water.
 */
function sourceOfMethod(method: string | undefined): CruiseGeometrySource {
  if (method === RECORDED_TRACK_METHOD) return "track";
  if (method === "manual_polyline") return "drawn";
  if (method === "haversine") return "chord";
  return "sea_route";
}

function windowDto(window: { startAt: Date; endAt: Date } | null): WindowDto | null {
  return window === null
    ? null
    : { startAt: window.startAt.toISOString(), endAt: window.endAt.toISOString() };
}

interface SequenceEntry {
  id: number;
  lat: number;
  lon: number;
  name: string;
  stop: WindowStop | null;
}

/** Null when the cruise does not exist or belongs to someone else. */
export async function loadCruiseTrackOverview(
  cruiseId: string,
  userId: string
): Promise<CruiseTrackOverview | null> {
  const cruise = await prisma.cruise.findFirst({
    where: { id: cruiseId, userId },
    include: {
      departurePort: true,
      arrivalPort: true,
      stops: { orderBy: { dayNumber: "asc" }, include: { port: true } },
      legs: {
        orderBy: { ordinal: "asc" },
        select: { ordinal: true, distanceKm: true, method: true },
      },
      tracks: {
        orderBy: { startedAt: "asc" },
        select: {
          ...CRUISE_TRACK_COVERAGE_SELECT,
          cruiseId: true,
          source: true,
          name: true,
          endedAt: true,
          pointCount: true,
          distanceKm: true,
          truncated: true,
          externalRef: true,
          createdAt: true,
        },
      },
    },
  });
  if (!cruise) return null;

  const entry = (
    p: { id: number; lat: number; lon: number; name: string },
    stop: WindowStop | null
  ): SequenceEntry => ({ id: p.id, lat: p.lat, lon: p.lon, name: p.name, stop });
  const portCalls = cruise.stops
    .filter((s) => !s.isAtSea && s.port !== null)
    .map((s) => entry(s.port!, s));
  const sequence = buildEffectivePortSequence(
    cruise.departurePort ? entry(cruise.departurePort, null) : null,
    portCalls,
    cruise.arrivalPort ? entry(cruise.arrivalPort, null) : null
  );

  const { recorded, verdicts } = resolveRecordedLegs(sequence, cruise.tracks);
  const legByOrdinal = new Map(cruise.legs.map((l) => [l.ordinal, l]));

  const legs: CruiseLegTrackDto[] = sequence.slice(1).map((to, i) => {
    const from = sequence[i];
    const persisted = legByOrdinal.get(i);
    return {
      ordinal: i,
      fromPortId: from.id,
      toPortId: to.id,
      fromPortName: from.name,
      toPortName: to.name,
      distanceKm: persisted?.distanceKm ?? null,
      geometrySource: sourceOfMethod(persisted?.method),
      coverage: verdicts[i],
      window: windowDto(cruiseLegWindow(from.stop, to.stop, cruise)),
    };
  });

  const tracks: CruiseTrackMetaDto[] = cruise.tracks.map((t) => ({
    id: t.id,
    cruiseId: t.cruiseId,
    source: t.source,
    name: t.name,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    pointCount: t.pointCount,
    distanceKm: t.distanceKm,
    truncated: t.truncated,
    externalRef: t.externalRef,
    createdAt: t.createdAt,
    coveredLegs: recorded.flatMap((leg, i) => (leg?.trackId === t.id ? [i] : [])),
  }));

  return { tracks, legs, window: windowDto(cruiseWindow(cruise.stops, cruise)) };
}
