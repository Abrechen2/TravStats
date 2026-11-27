import { prisma } from "../../../db";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { deriveDay } from "../dayDerivation";
import type { Span } from "../readSafe";
import logger from "../../../utils/logger";
import type { Stop } from "../legs/types";
import { stopIdentityFor } from "../stopPlaces/identity";
import {
  PREVIEW_DEFAULTS,
  buildRoadtripPreview,
  type PreviewPlace,
  type RoadtripPreview,
  type SuggestedName,
} from "./preview";

/**
 * The read behind "Als Roadtrip übernehmen" (rc46 extras A): one derivation
 * over the whole span — the same privacy-safe segments and stops the day view
 * draws (`deriveDay`), so a station is never a place the day view does not
 * show, and never one inside a privacy zone.
 */

/** Two weeks: a roadtrip, not a year — and a bounded read. */
export const PREVIEW_MAX_DAYS = 14;

export type PreviewFailure = "tooLong" | "noPoints" | "truncated" | "tooFewStations";

export class PreviewError extends Error {
  constructor(readonly reason: PreviewFailure) {
    super(`Roadtrip preview failed: ${reason}`);
    this.name = "PreviewError";
  }
}

const PLACE_MARGIN_DEG = 0.01;

async function placesAround(userId: string, preview: { lat: number; lon: number }[]) {
  const lats = preview.map((p) => p.lat);
  const lons = preview.map((p) => p.lon);
  const rows = await prisma.place.findMany({
    where: {
      userId,
      lat: { gte: Math.min(...lats) - PLACE_MARGIN_DEG, lte: Math.max(...lats) + PLACE_MARGIN_DEG },
      lon: { gte: Math.min(...lons) - PLACE_MARGIN_DEG, lte: Math.max(...lons) + PLACE_MARGIN_DEG },
    },
    select: { id: true, name: true, lat: true, lon: true },
    take: 2000,
  });
  return rows as PreviewPlace[];
}

/**
 * The names the stops' visit suggestions carry: the suggestion's place, else
 * its own name, else what its evidence names (a plugin's venue, a calendar
 * entry's title). Read in one query for the stops of the span.
 */
async function suggestedNames(userId: string, stops: readonly Stop[]): Promise<SuggestedName> {
  const ids = [...new Set(stops.map((s) => s.stayRef?.id).filter((id): id is string => !!id))];
  const rows = ids.length
    ? await prisma.dawarichStay.findMany({
        where: { userId, id: { in: ids } },
        select: { id: true, name: true, place: { select: { name: true } } },
      })
    : [];
  const byId = new Map(
    rows.map((r) => [r.id, r.place?.name?.trim() || r.name?.trim() || null] as const)
  );
  const recorded = (stop: Stop): string | null => {
    const fromStay = stop.stayRef ? (byId.get(stop.stayRef.id) ?? null) : null;
    if (fromStay) return fromStay;
    const source = stop.evidence?.source;
    if (source?.kind === "plugin") return source.name.trim() || null;
    if (source?.kind === "calendar") return source.title.trim() || null;
    return null;
  };
  // What the day view suggests for a stop with no name yet (rc46 UAT: "Halt 1–6" here,
  // "Via Litoranea Nord" there): the same identity lookup, for the stations only.
  const asked = stops
    .filter(
      (s) =>
        !s.dismissed &&
        s.untilMs - s.fromMs >= PREVIEW_DEFAULTS.minDwellMs &&
        !s.place?.name &&
        !recorded(s)
    )
    .slice(0, MAX_IDENTITY_LOOKUPS);
  const looked = new Map<number, string>();
  for (let i = 0; i < asked.length; i += IDENTITY_CONCURRENCY) {
    await Promise.all(
      asked.slice(i, i + IDENTITY_CONCURRENCY).map(async (s) => {
        try {
          const identity = await stopIdentityFor(userId, {
            lat: s.anchor.lat,
            lon: s.anchor.lon,
            fromMs: s.fromMs,
            untilMs: s.untilMs,
          });
          const name = identity.probable?.name.trim();
          if (name) looked.set(s.fromMs, name);
        } catch (err) {
          // A name is a suggestion: the station stays "Halt N" for the user to name.
          logger.warn({ err, fromMs: s.fromMs }, "roadtrip preview: stop identity failed");
        }
      })
    );
  }
  return (stop) => recorded(stop) ?? looked.get(stop.fromMs) ?? null;
}

/** A two-week span can hold many stops; the lookup may reach a geocoder per stop. */
const MAX_IDENTITY_LOOKUPS = 40;
const IDENTITY_CONCURRENCY = 4;

export async function roadtripPreviewFor(
  userId: string,
  span: Span,
  days: number
): Promise<RoadtripPreview & { zone: string }> {
  if (days > PREVIEW_MAX_DAYS) throw new PreviewError("tooLong");
  const { raw, read, stops } = await deriveDay(userId, span);
  if (raw.next !== null) throw new PreviewError("truncated");
  const anchors = [
    ...read.segments.flat().map(([, lat, lon]) => ({ lat, lon })),
    ...stops.map((s) => s.anchor),
  ];
  if (anchors.length === 0) throw new PreviewError("noPoints");
  const preview = buildRoadtripPreview(
    read.segments,
    stops,
    await placesAround(userId, anchors),
    {},
    await suggestedNames(userId, stops)
  );
  if (!preview) throw new PreviewError("noPoints");
  if (preview.stations.length < 2) throw new PreviewError("tooFewStations");
  // The clock the stations are dated on: the profile zone the days were read in.
  return { ...preview, zone: (await profileZoneOf(userId)).zone };
}
