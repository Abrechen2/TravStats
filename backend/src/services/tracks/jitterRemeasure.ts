import { prisma } from "../../db";
import { createDawarichClient, type DawarichClient } from "../dawarich/dawarichClient";
import { getDawarichConnection } from "../dawarich/dawarichResolver";
import { DawarichError } from "../dawarich/errors";
import { cruiseTrackColumns, prepareCruiseTrack } from "../cruise/prepareCruiseTrack";
import { recomputeLegsForCruise } from "../cruiseDistance/cruiseLegService";
import { propagateWrite, shareSnapshot, SHARE_TX_TIMEOUT_MS } from "../sharing/propagate";
import { ingestTrack } from "../tour/tracks/ingestTrack";
import { toParsedTrack } from "../tour/tracks/pullDawarichTrack";
import { ingestedTrackColumns } from "../tour/tracks/trackRow";
import type { ParsedTrack } from "../tour/tracks/parseGpx";
import { filterParsedTrack } from "./recordingJitter";
import { tourJitterMode } from "./jitterProfiles";
import logger from "../../utils/logger";

/**
 * Re-measures recordings stored before the jitter filter (forgejo#319) —
 * where, and only where, the raw points still exist.
 *
 * What each source kept, and so what can be recomputed:
 *
 * | Source                                   | Raw points kept?                      | Re-measured |
 * |------------------------------------------|---------------------------------------|-------------|
 * | Trip recording (`trip_recording_batches`) | yes, here                             | needs none: filtered on every read |
 * | Tour / cruise track pulled from Dawarich  | yes, in the user's Dawarich           | yes, by this job |
 * | Flight recording (`flight_tracks`)        | no — a simplified line without times  | no |
 * | Tour / cruise GPX, TCX, FIT, KML upload   | no — the file is never stored         | no |
 * | Strava, HealthKit, Health Connect import  | no — a simplified line without times  | no |
 *
 * A simplified line has no times. Without times a stay cannot be told from
 * slow movement, nor a teleport from a fast leg, so filtering it would be a
 * guess — and a guessed distance written over a measured one. Those rows keep
 * `jitterDropped = NULL` ("not checked"), which the pages say, and a new
 * upload of the same recording is filtered like any other.
 *
 * A Dawarich track is pulled again for exactly its stored span and replaced
 * ONLY when Dawarich still answers with the same number of points the row was
 * measured from: points added or deleted since mean the source is not the one
 * that was measured, and the row is left alone rather than silently becoming
 * a different recording. A pull that was cut at the page cap (`truncated`) is
 * never re-pulled — its span is a slice, and the same slice is not
 * guaranteed. Every row it cannot re-measure is left exactly as it was.
 *
 * Bounded (`limit` rows per call) and resumable: a re-measured row carries a
 * number, so the next call takes the next rows; a row that could not be
 * re-measured is remembered in `attempted` so one run does not try it twice.
 *
 * What does not follow: a tour leg that ADOPTED a slice of a track copied its
 * line and kilometres at that moment (`adoptTrack.ts`) and keeps them; a
 * cruise's legs are recomputed from the re-measured track in the same
 * transaction, as on every cruise track write.
 */

export type RemeasureSkip = "notConfigured" | "sourceChanged" | "unavailable";

export interface RemeasureReport {
  remeasured: number;
  skipped: Record<RemeasureSkip, number>;
  /** Rows looked at this call; 0 means nothing is left to try. */
  examined: number;
}

export interface RemeasureOptions {
  limit: number;
  /** Ids already tried in this run; filled as rows are tried. */
  attempted: Set<string>;
  /** The user's Dawarich, or null when none is configured. Injectable for tests. */
  clientFor?: (userId: string) => Promise<DawarichClient | null>;
}

/** Dawarich's timestamps are whole seconds; the span is asked with a second either side. */
const SPAN_PADDING_MS = 1000;

async function defaultClientFor(userId: string): Promise<DawarichClient | null> {
  const connection = await getDawarichConnection(userId);
  return connection ? createDawarichClient(connection) : null;
}

interface Candidate {
  id: string;
  userId: string;
  startedAt: Date;
  endedAt: Date;
  pointCount: number;
}

/**
 * The stored span pulled again, exactly; null when Dawarich no longer holds
 * the points the row was measured from.
 */
async function pullSameSpan(client: DawarichClient, row: Candidate): Promise<ParsedTrack | null> {
  const { points, truncated } = await client.getPoints({
    startAt: new Date(row.startedAt.getTime() - SPAN_PADDING_MS),
    endAt: new Date(row.endedAt.getTime() + SPAN_PADDING_MS),
  });
  const inSpan = points.filter(
    (p) => p.timestampMs >= row.startedAt.getTime() && p.timestampMs <= row.endedAt.getTime()
  );
  if (truncated || inSpan.length !== row.pointCount || inSpan.length < 2) return null;
  return toParsedTrack(inSpan);
}

async function remeasureTourTrack(
  row: Candidate & { mode: string; activity: string | null },
  parsed: ParsedTrack
): Promise<boolean> {
  const ingested = ingestTrack(filterParsedTrack(parsed, tourJitterMode(row)));
  if (!ingested) return false;
  // The span stays the stored one: it is what the row was measured over.
  const { startedAt: _s, endedAt: _e, ...columns } = ingestedTrackColumns(ingested);
  await prisma.tripRouteTrack.update({ where: { id: row.id }, data: columns });
  return true;
}

async function remeasureCruiseTrack(
  row: Candidate & { cruiseId: string },
  parsed: ParsedTrack
): Promise<boolean> {
  const ingested = ingestTrack(prepareCruiseTrack(parsed));
  if (!ingested) return false;
  const { startedAt: _s, endedAt: _e, ...columns } = cruiseTrackColumns(ingested);
  await prisma.$transaction(
    async (tx) => {
      const before = await shareSnapshot(tx, "cruise", row.cruiseId);
      await tx.cruiseTrack.update({ where: { id: row.id }, data: columns });
      await recomputeLegsForCruise(row.cruiseId, tx);
      await propagateWrite(tx, row.userId, "cruise", row.cruiseId, before);
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
  return true;
}

async function candidates(limit: number, attempted: ReadonlySet<string>) {
  const where = {
    source: "dawarich",
    jitterDropped: null,
    truncated: false,
    id: { notIn: [...attempted] },
  };
  const tours = await prisma.tripRouteTrack.findMany({
    where,
    orderBy: { id: "asc" },
    take: limit,
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      pointCount: true,
      route: { select: { userId: true, mode: true, activity: true } },
    },
  });
  const cruises = await prisma.cruiseTrack.findMany({
    where,
    orderBy: { id: "asc" },
    take: Math.max(0, limit - tours.length),
    select: {
      id: true,
      cruiseId: true,
      startedAt: true,
      endedAt: true,
      pointCount: true,
      cruise: { select: { userId: true } },
    },
  });
  return {
    tours: tours.map(({ route, ...t }) => ({ ...t, ...route })),
    cruises: cruises.map(({ cruise, ...c }) => ({ ...c, userId: cruise.userId })),
  };
}

/** One bounded pass. */
export async function remeasureStoredTracks(options: RemeasureOptions): Promise<RemeasureReport> {
  const clientFor = options.clientFor ?? defaultClientFor;
  const report: RemeasureReport = {
    remeasured: 0,
    skipped: { notConfigured: 0, sourceChanged: 0, unavailable: 0 },
    examined: 0,
  };
  const { tours, cruises } = await candidates(options.limit, options.attempted);
  const clients = new Map<string, DawarichClient | null>();

  const attempt = async <R extends Candidate>(
    row: R,
    write: (row: R, parsed: ParsedTrack) => Promise<boolean>
  ) => {
    options.attempted.add(row.id);
    report.examined += 1;
    if (!clients.has(row.userId)) clients.set(row.userId, await clientFor(row.userId));
    const client = clients.get(row.userId);
    if (!client) {
      report.skipped.notConfigured += 1;
      return;
    }
    try {
      const parsed = await pullSameSpan(client, row);
      if (parsed && (await write(row, parsed))) report.remeasured += 1;
      else report.skipped.sourceChanged += 1;
    } catch (error) {
      if (!(error instanceof DawarichError)) throw error;
      report.skipped.unavailable += 1;
      logger.warn({
        operation: "track.jitter.remeasure.unavailable",
        trackId: row.id,
        kind: error.kind,
      });
    }
  };

  for (const row of tours) await attempt(row, remeasureTourTrack);
  for (const row of cruises) await attempt(row, remeasureCruiseTrack);
  return report;
}
