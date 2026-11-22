import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { haversineKm, polylineLengthKm } from "../../shared/geo/haversine";
import type { VesselPosition } from "../ferry/aisStream";
import { propagateWrite, shareSnapshot, SHARE_TX_TIMEOUT_MS } from "../sharing/propagate";
import { dropCruiseAisRecording } from "./cruiseAisTrack";
import {
  isOfferedCandidate,
  lookupKeyOf,
  resolveVessel,
  searchKeyOf,
  type VesselResolution,
} from "./vesselResolver";
import { isMmsi } from "./vesselName";

/**
 * A ferry crossing or a cruise seen as one vessel journey: who sails it, when,
 * between which points — what the resolver, the poller and the detail page
 * need, read the same way for both domains.
 */

export type VesselJourneyKind = "ferry" | "cruise";

export interface VesselJourney {
  kind: VesselJourneyKind;
  id: string;
  userId: string;
  vesselName: string | null;
  operator: string | null;
  imo: string | null;
  shipId: number | null;
  mmsi: string | null;
  mmsiSource: string | null;
  start: Date | null;
  end: Date | null;
  dep: { lat: number; lon: number } | null;
  arr: { lat: number; lon: number } | null;
  cancelled: boolean;
}

/** Before departure and after arrival the poller still listens this long. */
export const IN_PROGRESS_MARGIN_MS = 60 * 60 * 1000;
/** A crossing without an arrival time is taken to last at most this long. */
const FERRY_DEFAULT_SPAN_MS = 24 * 60 * 60 * 1000;
/** A cruise's dates are days: the last day lasts until its end. */
const CRUISE_LAST_DAY_MS = 36 * 60 * 60 * 1000;
/** A fix this close to a terminal counts as having been there. */
export const COVER_KM = 5;
/** Two consecutive fixes further apart in time than this leave a hole: no full coverage. */
export const COVER_MAX_GAP_MS = 45 * 60 * 1000;

export async function loadVesselJourney(
  kind: VesselJourneyKind,
  id: string,
  userId: string
): Promise<VesselJourney | null> {
  if (kind === "ferry") {
    const f = await prisma.ferryJourney.findFirst({ where: { id, userId } });
    if (!f) return null;
    return {
      kind,
      id: f.id,
      userId: f.userId,
      vesselName: f.vesselName,
      operator: f.operator,
      imo: null,
      shipId: null,
      mmsi: f.vesselMmsi,
      mmsiSource: f.vesselMmsiSource,
      start: f.actualDepartureTime ?? f.departureTime,
      end:
        f.actualArrivalTime ??
        f.arrivalTime ??
        new Date(f.departureTime.getTime() + FERRY_DEFAULT_SPAN_MS),
      dep: { lat: f.depLat, lon: f.depLon },
      arr: { lat: f.arrLat, lon: f.arrLon },
      cancelled: f.status === "cancelled",
    };
  }
  const c = await prisma.cruise.findFirst({
    where: { id, userId },
    include: { ship: true, departurePort: true, arrivalPort: true },
  });
  if (!c) return null;
  return {
    kind,
    id: c.id,
    userId: c.userId,
    vesselName: c.ship?.name ?? c.shipNameOverride,
    operator: c.cruiseLine ?? c.ship?.cruiseLine ?? null,
    imo: c.ship?.imo ?? null,
    shipId: c.shipId,
    mmsi: c.vesselMmsi,
    mmsiSource: c.vesselMmsiSource,
    start: c.startDate,
    end: c.endDate ? new Date(c.endDate.getTime() + CRUISE_LAST_DAY_MS) : null,
    dep: c.departurePort ? { lat: c.departurePort.lat, lon: c.departurePort.lon } : null,
    arr: c.arrivalPort ? { lat: c.arrivalPort.lat, lon: c.arrivalPort.lon } : null,
    cancelled: c.status === "cancelled",
  };
}

/** Departure ≤ now ≤ arrival, each widened by the margin. */
export function isInProgress(j: Pick<VesselJourney, "start" | "end" | "cancelled">, now: Date) {
  if (j.cancelled || !j.start || !j.end) return false;
  const t = now.getTime();
  return (
    j.start.getTime() - IN_PROGRESS_MARGIN_MS <= t && t <= j.end.getTime() + IN_PROGRESS_MARGIN_MS
  );
}

/** The box the AIS static-data step listens in: both ends, padded by about 100 km. */
export function areaOf(j: Pick<VesselJourney, "dep" | "arr">) {
  const pts = [j.dep, j.arr].filter((p): p is { lat: number; lon: number } => p !== null);
  if (pts.length === 0) return null;
  const pad = 1;
  return {
    minLat: Math.max(-90, Math.min(...pts.map((p) => p.lat)) - pad),
    maxLat: Math.min(90, Math.max(...pts.map((p) => p.lat)) + pad),
    minLon: Math.max(-180, Math.min(...pts.map((p) => p.lon)) - pad),
    maxLon: Math.min(180, Math.max(...pts.map((p) => p.lon)) + pad),
  };
}

async function writeMmsi(
  j: VesselJourney,
  mmsi: string | null,
  source: string | null,
  onlyIfUnset: boolean
): Promise<void> {
  // A resolution binds only into an empty column AND only while the ship is
  // still the one it was resolved for — a rename in between must not receive it.
  const base = { id: j.id, userId: j.userId, ...(onlyIfUnset ? { vesselMmsi: null } : {}) };
  const data = { vesselMmsi: mmsi, vesselMmsiSource: source };
  if (j.kind === "ferry") {
    const where = onlyIfUnset ? { ...base, vesselName: j.vesselName, operator: j.operator } : base;
    // share-exempt: the vessel MMSI is private to the account, never a share fact
    await prisma.ferryJourney.updateMany({ where, data });
  } else {
    const where = onlyIfUnset ? { ...base, shipId: j.shipId } : base;
    // share-exempt: the vessel MMSI is private to the account, never a share fact
    await prisma.cruise.updateMany({ where, data });
  }
}

/**
 * The journey's MMSI, resolving it when none is bound yet. A resolved MMSI is
 * bound only into an empty column, so a manual pick is never overwritten.
 */
export async function ensureVesselMmsi(
  j: VesselJourney,
  now = new Date(),
  { ais = true }: { ais?: boolean } = {}
): Promise<{ mmsi: string | null; resolution: VesselResolution | null }> {
  if (isMmsi(j.mmsi)) return { mmsi: j.mmsi, resolution: null };
  const resolution = await resolveVessel(
    {
      name: j.vesselName,
      operator: j.operator,
      imo: j.imo,
      shipId: j.shipId,
      area: areaOf(j),
      userId: j.userId,
      ais,
    },
    now
  );
  if (resolution.status !== "resolved") return { mmsi: null, resolution };
  await writeMmsi(j, resolution.mmsi, resolution.source, true);
  // Read back: the bind lost a race (a rename, a manual pick) when it did not land.
  const now2 = await loadVesselJourney(j.kind, j.id, j.userId);
  if (now2?.mmsi !== resolution.mmsi) return { mmsi: null, resolution };
  return { mmsi: resolution.mmsi, resolution };
}

/**
 * The hidden override ("Schiff zuordnen …"): bind a vessel the server itself
 * offered — for a candidate search of `query`, or for this journey's own
 * lookup. Raw digits from a client are refused: the column stays a server
 * fact, and a journey cannot be turned into an AIS proxy for any ship.
 */
export async function assignVessel(
  j: VesselJourney,
  mmsi: string,
  query: string | null
): Promise<void> {
  const keys = [lookupKeyOf({ name: j.vesselName, operator: j.operator, imo: j.imo })];
  if (query) keys.push(searchKeyOf(query));
  const offered = await isOfferedCandidate(
    mmsi,
    keys.filter((k): k is string => k !== null)
  );
  if (!offered) throw new AppError("Vessel was not offered", 400, "VESSEL_NOT_OFFERED", "mmsi");
  // The same ship again: only the source changes, the recording stays.
  if (offered.mmsi === j.mmsi) {
    await writeMmsi(j, offered.mmsi, "manual", false);
    return;
  }
  // The old ship's positions, and a cruise's AIS recording built from them, are
  // not this one's — dropped in the same transaction that binds the new ship.
  if (j.kind === "ferry") {
    await prisma.$transaction([
      // share-exempt: the vessel MMSI is private to the account, never a share fact
      prisma.ferryJourney.updateMany({
        where: { id: j.id, userId: j.userId },
        data: { vesselMmsi: offered.mmsi, vesselMmsiSource: "manual" },
      }),
      prisma.vesselPositionFix.deleteMany({ where: { ferryJourneyId: j.id } }),
    ]);
    return;
  }
  await dropCruiseAisRecording(j.id, j.userId, offered.mmsi);
}

/** Forget a resolved (not a manually picked) MMSI — the vessel's name or ship changed. */
export async function clearResolvedMmsi(kind: VesselJourneyKind, id: string, userId: string) {
  // NULL-safe: a plain NOT would also skip the rows whose source is NULL.
  const where = {
    id,
    userId,
    OR: [{ vesselMmsiSource: null }, { vesselMmsiSource: { not: "manual" } }],
  };
  const data = { vesselMmsi: null, vesselMmsiSource: null };
  // share-exempt: the vessel MMSI is private to the account, never a share fact
  if (kind === "ferry") await prisma.ferryJourney.updateMany({ where, data });
  // share-exempt: the vessel MMSI is private to the account, never a share fact
  else await prisma.cruise.updateMany({ where, data });
}

/** Stored fixes per journey, at most. Ten-minute polling fills it in three weeks. */
export const MAX_FIXES_PER_JOURNEY = 3000;
/** Two fixes closer in time than this are one. */
export const MIN_FIX_GAP_MS = 4 * 60 * 1000;

/** Store one AIS position for the journey: deduplicated by time, bounded per journey. */
export async function storeFix(j: VesselJourney, p: VesselPosition): Promise<boolean> {
  const observedAt = new Date(p.observedAt ?? p.receivedAt);
  const scope = j.kind === "ferry" ? { ferryJourneyId: j.id } : { cruiseId: j.id };
  const [count, near] = await Promise.all([
    prisma.vesselPositionFix.count({ where: scope }),
    prisma.vesselPositionFix.findFirst({
      where: {
        ...scope,
        observedAt: {
          gt: new Date(observedAt.getTime() - MIN_FIX_GAP_MS),
          lt: new Date(observedAt.getTime() + MIN_FIX_GAP_MS),
        },
      },
      select: { id: true },
    }),
  ]);
  if (near || count >= MAX_FIXES_PER_JOURNEY) return false;
  // The journey may have changed ship since the poll began: store only for the bound one.
  const still =
    j.kind === "ferry"
      ? await prisma.ferryJourney.count({ where: { id: j.id, vesselMmsi: p.mmsi } })
      : await prisma.cruise.count({ where: { id: j.id, vesselMmsi: p.mmsi } });
  if (still !== 1) return false;
  const created = await prisma.vesselPositionFix.createMany({
    data: [
      {
        ...scope,
        userId: j.userId,
        mmsi: p.mmsi,
        observedAt,
        receivedAt: new Date(p.receivedAt),
        lat: p.lat,
        lon: p.lon,
        speedKnots: p.speedKnots,
        courseDegrees: p.courseDegrees,
      },
    ],
    skipDuplicates: true,
  });
  return created.count === 1;
}

export interface RecordedVesselTrack {
  /** `[lon, lat]`, in time order. */
  coordinates: Array<[number, number]>;
  distanceKm: number;
  /** Starts at the departure point and ends at the arrival point (within `COVER_KM`). */
  coversJourney: boolean;
  firstAt: string;
  lastAt: string;
}

export function trackFromFixes(
  fixes: Array<{ lat: number; lon: number; observedAt: Date }>,
  j: Pick<VesselJourney, "dep" | "arr">
): RecordedVesselTrack | null {
  if (fixes.length === 0) return null;
  const first = fixes[0];
  const last = fixes[fixes.length - 1];
  const holes = fixes.some(
    (f, i) => i > 0 && f.observedAt.getTime() - fixes[i - 1].observedAt.getTime() > COVER_MAX_GAP_MS
  );
  const covers =
    fixes.length >= 2 &&
    !holes &&
    j.dep !== null &&
    j.arr !== null &&
    haversineKm(j.dep, first) <= COVER_KM &&
    haversineKm(j.arr, last) <= COVER_KM;
  return {
    coordinates: fixes.map((f) => [f.lon, f.lat]),
    distanceKm: Math.round(polylineLengthKm(fixes) * 10) / 10,
    coversJourney: covers,
    firstAt: first.observedAt.toISOString(),
    lastAt: last.observedAt.toISOString(),
  };
}

export async function loadFixes(j: Pick<VesselJourney, "kind" | "id">) {
  return prisma.vesselPositionFix.findMany({
    where: j.kind === "ferry" ? { ferryJourneyId: j.id } : { cruiseId: j.id },
    orderBy: { observedAt: "asc" },
    select: {
      lat: true,
      lon: true,
      observedAt: true,
      receivedAt: true,
      speedKnots: true,
      courseDegrees: true,
      mmsi: true,
    },
  });
}

/**
 * A crossing's distance follows its recorded track once the track covers the
 * whole crossing — never a typed distance, and never the line: a drawn or
 * routed route stays what the map shows (forgejo#431); the track is drawn
 * beside it.
 */
export async function adoptFerryTrackDistance(j: VesselJourney, track: RecordedVesselTrack) {
  if (j.kind !== "ferry" || !track.coversJourney) return false;
  return prisma.$transaction(
    async (tx) => {
      const before = await shareSnapshot(tx, "ferry", j.id);
      const saved = await tx.ferryJourney.updateMany({
        where: {
          id: j.id,
          userId: j.userId,
          OR: [{ distanceSource: null }, { distanceSource: { not: "user" } }],
        },
        data: { distanceKm: track.distanceKm, distanceSource: "ais_track" },
      });
      if (saved.count === 1) await propagateWrite(tx, j.userId, "ferry", j.id, before);
      return saved.count === 1;
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
}
