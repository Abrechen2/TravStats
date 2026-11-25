import { prisma } from "../../../db";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { deriveDay } from "../dayDerivation";
import type { Span } from "../readSafe";
import { buildRoadtripPreview, type PreviewPlace, type RoadtripPreview } from "./preview";

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
  const preview = buildRoadtripPreview(read.segments, stops, await placesAround(userId, anchors));
  if (!preview) throw new PreviewError("noPoints");
  if (preview.stations.length < 2) throw new PreviewError("tooFewStations");
  // The clock the stations are dated on: the profile zone the days were read in.
  return { ...preview, zone: (await profileZoneOf(userId)).zone };
}
