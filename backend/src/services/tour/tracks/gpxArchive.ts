import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

import { Prisma } from "../../../prisma";
import { ROUTE_KINDS, TOUR_ACTIVITIES } from "../../../shared/tour/roadtrip";
import { TRACK_SOURCES } from "../../../schemas/tour";
import type { ParsedTrack } from "./parseGpx";

/**
 * A stored recording as a GPX file, and back.
 *
 * TravStats does not keep a recording as it came in: the line is simplified
 * on import, per-point times and heights are dropped, and what survives are
 * the figures MEASURED on the raw points (distance, climb, moving time, the
 * running raw distance per kept vertex, the height profile). A GPX written
 * from that is a valid track for any other program — a simplified one — but
 * re-measuring it would report less climb and a shorter distance than the
 * recording had.
 *
 * So the file carries the stored measurements in a TravStats extension
 * block, and reading one of our own files back RESTORES them instead of
 * re-measuring: a tour moved between accounts arrives with the figures it
 * left with. Other programs ignore the block, as GPX 1.1 allows
 * (`extensionsType`, https://www.topografix.com/GPX/1/1/#type_extensionsType).
 *
 * The first and last point carry the recording's start and end — the only
 * two instants still known. Inventing times between them would fabricate a
 * pace the record never held.
 */

export const TRAVSTATS_GPX_NS = "https://travstats.de/xmlns/track/1";

const finite = z.number().finite();
const nonNegative = finite.min(0);

export const archiveBlockSchema = z.object({
  version: z.literal(1),
  tour: z.object({
    id: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(200),
    kind: z.enum(ROUTE_KINDS),
    activity: z.enum(TOUR_ACTIVITIES).nullable(),
    mode: z.string().min(1).max(20),
  }),
  track: z.object({
    id: z.string().min(1).max(64),
    source: z.enum(TRACK_SOURCES),
    name: z.string().max(500).nullable(),
    externalRef: z.string().max(200).nullable(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    pointCount: z.number().int().min(0).max(10_000_000),
    distanceKm: nonNegative.max(100_000),
    truncated: z.boolean(),
    ascentM: nonNegative.nullable(),
    descentM: nonNegative.nullable(),
    movingSeconds: z.number().int().min(0).nullable(),
    cumulativeKm: z.array(nonNegative).max(200_000).nullable(),
    elevations: z
      .array(z.tuple([finite, finite]))
      .max(20_000)
      .nullable(),
  }),
});
export type ArchiveBlock = z.infer<typeof archiveBlockSchema>;

export interface ExportableTrack {
  id: string;
  source: string;
  name: string | null;
  externalRef: string | null;
  startedAt: Date;
  endedAt: Date;
  pointCount: number;
  distanceKm: number;
  truncated: boolean;
  ascentM: number | null;
  descentM: number | null;
  movingSeconds: number | null;
  geometry: Prisma.JsonValue;
  segmentStarts: Prisma.JsonValue;
  cumulativeKm: Prisma.JsonValue;
  elevations: Prisma.JsonValue;
}

export interface ExportableTour {
  id: string;
  name: string;
  kind: string;
  activity: string | null;
  mode: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JSON inside CDATA: the one sequence CDATA cannot hold is split across two sections. */
function cdata(text: string): string {
  return `<![CDATA[${text.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

function asLine(value: Prisma.JsonValue): Array<[number, number]> {
  return Array.isArray(value)
    ? value.filter(
        (p): p is [number, number] =>
          Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number"
      )
    : [];
}

function asNumbers(value: Prisma.JsonValue): number[] | null {
  return Array.isArray(value) && value.every((n) => typeof n === "number")
    ? (value as number[])
    : null;
}

/** One recording as a GPX 1.1 document with its measurements attached. */
export function trackToGpx(tour: ExportableTour, track: ExportableTrack): string {
  const line = asLine(track.geometry);
  const starts = asNumbers(track.segmentStarts) ?? [0];
  const block: ArchiveBlock = {
    version: 1,
    tour: {
      id: tour.id,
      name: tour.name,
      kind: tour.kind as ArchiveBlock["tour"]["kind"],
      activity: tour.activity as ArchiveBlock["tour"]["activity"],
      mode: tour.mode,
    },
    track: {
      id: track.id,
      source: track.source as ArchiveBlock["track"]["source"],
      name: track.name,
      externalRef: track.externalRef,
      startedAt: track.startedAt.toISOString(),
      endedAt: track.endedAt.toISOString(),
      pointCount: track.pointCount,
      distanceKm: track.distanceKm,
      truncated: track.truncated,
      ascentM: track.ascentM,
      descentM: track.descentM,
      movingSeconds: track.movingSeconds,
      cumulativeKm: asNumbers(track.cumulativeKm),
      elevations: Array.isArray(track.elevations)
        ? (track.elevations as unknown as Array<[number, number]>)
        : null,
    },
  };

  const segments: string[] = [];
  const bounds = [...starts.filter((s) => s >= 0 && s < line.length), line.length];
  for (let i = 0; i < bounds.length - 1; i++) {
    const pts = line.slice(bounds[i], bounds[i + 1]).map(([lon, lat], j, arr) => {
      const globalIndex = bounds[i] + j;
      const time =
        globalIndex === 0
          ? track.startedAt
          : globalIndex === line.length - 1 && j === arr.length - 1
            ? track.endedAt
            : null;
      return `      <trkpt lat="${lat}" lon="${lon}">${time ? `<time>${time.toISOString()}</time>` : ""}</trkpt>`;
    });
    segments.push(`    <trkseg>\n${pts.join("\n")}\n    </trkseg>`);
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="TravStats" xmlns="http://www.topografix.com/GPX/1/1" xmlns:ts="${TRAVSTATS_GPX_NS}">`,
    `  <metadata>`,
    `    <name>${escapeXml(tour.name)}</name>`,
    `    <time>${track.startedAt.toISOString()}</time>`,
    `    <extensions><ts:track>${cdata(JSON.stringify(block))}</ts:track></extensions>`,
    `  </metadata>`,
    `  <trk>`,
    `    <name>${escapeXml(track.name ?? tour.name)}</name>`,
    ...(tour.activity ? [`    <type>${escapeXml(tour.activity)}</type>`] : []),
    ...segments,
    `  </trk>`,
    `</gpx>`,
  ].join("\n");
}

/**
 * The TravStats block of a GPX file, or null when the file is someone else's
 * (or ours, edited beyond recognition). Validated like any other input: the
 * file came from a user's disk.
 */
export function readArchiveBlock(xml: string): ArchiveBlock | null {
  let doc: unknown;
  try {
    doc = new XMLParser({
      ignoreAttributes: true,
      removeNSPrefix: true,
      cdataPropName: "__cdata",
    }).parse(xml);
  } catch {
    return null;
  }
  const holder = (doc as { gpx?: { metadata?: { extensions?: { track?: unknown } } } })?.gpx
    ?.metadata?.extensions?.track;
  const raw =
    typeof holder === "string" ? holder : (holder as { __cdata?: unknown } | undefined)?.__cdata;
  const text = Array.isArray(raw) ? raw.join("") : raw;
  if (typeof text !== "string") return null;
  try {
    const parsed = archiveBlockSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The stored columns of a recording restored from our own file: the line and
 * its segment boundaries as the file draws them, every measured figure as
 * the block carries it. A running-distance list that no longer lines up with
 * the line (someone edited points) is dropped rather than trusted.
 */
export function restoredTrackColumns(parsed: ParsedTrack, block: ArchiveBlock) {
  const t = block.track;
  const cumulative =
    t.cumulativeKm && t.cumulativeKm.length === parsed.points.length ? t.cumulativeKm : null;
  return {
    startedAt: new Date(t.startedAt),
    endedAt: new Date(t.endedAt),
    geometry: parsed.points as unknown as Prisma.InputJsonValue,
    segmentStarts: parsed.segmentStarts as unknown as Prisma.InputJsonValue,
    cumulativeKm:
      cumulative === null ? Prisma.JsonNull : (cumulative as unknown as Prisma.InputJsonValue),
    pointCount: t.pointCount,
    distanceKm: t.distanceKm,
    elevations:
      t.elevations === null ? Prisma.JsonNull : (t.elevations as unknown as Prisma.InputJsonValue),
    ascentM: t.ascentM,
    descentM: t.descentM,
    movingSeconds: t.movingSeconds,
    truncated: t.truncated,
    source: t.source,
    name: t.name,
  };
}

/** A file name no filesystem objects to, readable enough to find a tour by. */
export function gpxFileName(tourName: string, startedAt: Date, suffix = ""): string {
  const safe = tourName
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${startedAt.toISOString().slice(0, 10)}_${safe || "tour"}${suffix}.gpx`;
}
