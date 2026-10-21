import { prisma, type DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import { createDawarichClient, type DawarichClient } from "../dawarich/dawarichClient";
import type { DawarichPoint } from "../dawarich/dawarichClient";
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
 * **Same source, proven.** A Dawarich track is pulled again for exactly its
 * stored span and replaced ONLY when the answer is provably the recording the
 * row was measured from: the same number of points, starting and ending at
 * the stored instants, and every vertex of the stored line found, in order and
 * to the last digit, among the pulled points — the stored line was simplified
 * FROM those points, so it is a subsequence of them. A count alone proved
 * nothing: an edited history, or another Dawarich behind the same account,
 * can answer with as many points (review of forgejo#319). Which connection
 * was used at the original pull was never stored, so the URL cannot be
 * compared; the line comparison is what binds the two. A truncated pull is
 * never re-pulled — its span is a slice, and the same slice is not
 * guaranteed.
 *
 * **Undoable.** The replaced columns and the Dawarich URL the new points came
 * from are kept in `track_jitter_remeasures.previous`, written in the same
 * transaction as the replacement.
 *
 * **Tried once, persistently.** Every attempt is recorded per track with its
 * outcome. `sourceChanged` is final; `notConfigured` waits a month (the user
 * may connect Dawarich later); `unavailable` backs off exponentially from an
 * hour to a week, across boots. Three `unavailable` answers in a row stop a
 * user's backlog for the rest of the run — their server is down, not each
 * track.
 *
 * What does not follow: a tour leg that ADOPTED a slice of a track copied its
 * line and kilometres at that moment (`adoptTrack.ts`) and keeps them; a
 * cruise's legs are recomputed from the re-measured track in the same
 * transaction, as on every cruise track write.
 */

export type RemeasureSkip = "notConfigured" | "sourceChanged" | "unavailable";
type Outcome = RemeasureSkip | "remeasured";

export interface RemeasureReport {
  remeasured: number;
  skipped: Record<RemeasureSkip, number>;
  /** Rows looked at this call; 0 means nothing is left to try. */
  examined: number;
}

/** A user's Dawarich as the job uses it. */
export interface DawarichSource {
  client: DawarichClient;
  /** Where the points come from, kept with the replaced measurement. */
  sourceUrl: string;
}

export interface RemeasureOptions {
  limit: number;
  /** Ids already tried in this run; filled as rows are tried. */
  attempted: Set<string>;
  /** Users whose connection failed `BREAKER_FAILURES` times in a row this run. */
  trippedUsers?: Set<string>;
  /** `unavailable` answers in a row per user, carried across a run's batches. */
  failuresInARow?: Map<string, number>;
  /** The user's Dawarich, or null when none is configured. Injectable for tests. */
  clientFor?: (userId: string) => Promise<DawarichSource | null>;
  now?: () => Date;
}

/** Dawarich's timestamps are whole seconds; the span is asked with a second either side. */
const SPAN_PADDING_MS = 1000;
/** `unavailable` answers in a row after which a user's backlog waits for the next run. */
export const BREAKER_FAILURES = 3;
const HOUR_MS = 3_600_000;
const NOT_CONFIGURED_RETRY_MS = 30 * 24 * HOUR_MS;
const BACKOFF_CAP_MS = 7 * 24 * HOUR_MS;

async function defaultClientFor(userId: string): Promise<DawarichSource | null> {
  const connection = await getDawarichConnection(userId);
  return connection
    ? { client: createDawarichClient(connection), sourceUrl: connection.baseUrl }
    : null;
}

interface Candidate {
  id: string;
  userId: string;
  startedAt: Date;
  endedAt: Date;
  pointCount: number;
  geometry: Prisma.JsonValue;
  attempts: number;
}

/** Whether `line` appears, vertex by vertex and in order, among `points`. */
function isSubsequence(line: Prisma.JsonValue, points: readonly DawarichPoint[]): boolean {
  if (!Array.isArray(line) || line.length === 0) return false;
  let cursor = 0;
  for (const vertex of line) {
    if (!Array.isArray(vertex)) return false;
    const [lon, lat] = vertex;
    while (
      cursor < points.length &&
      (points[cursor].longitude !== lon || points[cursor].latitude !== lat)
    ) {
      cursor++;
    }
    if (cursor === points.length) return false;
    cursor++;
  }
  return true;
}

/** The stored span pulled again; null unless it is provably the same recording. */
async function pullSameRecording(
  client: DawarichClient,
  row: Candidate
): Promise<ParsedTrack | null> {
  const { points, truncated } = await client.getPoints({
    startAt: new Date(row.startedAt.getTime() - SPAN_PADDING_MS),
    endAt: new Date(row.endedAt.getTime() + SPAN_PADDING_MS),
  });
  const inSpan = points.filter(
    (p) => p.timestampMs >= row.startedAt.getTime() && p.timestampMs <= row.endedAt.getTime()
  );
  const same =
    !truncated &&
    inSpan.length === row.pointCount &&
    inSpan.length >= 2 &&
    inSpan[0].timestampMs === row.startedAt.getTime() &&
    inSpan[inSpan.length - 1].timestampMs === row.endedAt.getTime() &&
    isSubsequence(row.geometry, inSpan);
  return same ? toParsedTrack(inSpan) : null;
}

/** Records an attempt; a final outcome never comes round again. */
async function record(
  db: DbTransaction,
  key: { routeTrackId: string } | { cruiseTrackId: string },
  row: Candidate,
  outcome: Outcome,
  now: Date,
  previous?: Prisma.InputJsonValue
): Promise<void> {
  const attempts = row.attempts + 1;
  const nextAttemptAt =
    outcome === "notConfigured"
      ? new Date(now.getTime() + NOT_CONFIGURED_RETRY_MS)
      : outcome === "unavailable"
        ? new Date(now.getTime() + Math.min(HOUR_MS * 2 ** (attempts - 1), BACKOFF_CAP_MS))
        : null;
  const data = {
    outcome,
    attempts,
    attemptedAt: now,
    nextAttemptAt,
    ...(previous === undefined ? {} : { previous }),
  };
  await db.trackJitterRemeasure.upsert({
    where: key,
    create: { ...key, userId: row.userId, ...data },
    update: data,
  });
}

async function remeasureTourTrack(
  row: Candidate & { mode: string; activity: string | null },
  parsed: ParsedTrack,
  sourceUrl: string,
  now: Date
): Promise<boolean> {
  const ingested = ingestTrack(filterParsedTrack(parsed, tourJitterMode(row)));
  if (!ingested) return false;
  // The span stays the stored one: it is what the row was measured over.
  const { startedAt: _s, endedAt: _e, ...columns } = ingestedTrackColumns(ingested);
  await prisma.$transaction(async (tx) => {
    const before = await tx.tripRouteTrack.findUniqueOrThrow({
      where: { id: row.id },
      select: {
        geometry: true,
        segmentStarts: true,
        cumulativeKm: true,
        pointCount: true,
        distanceKm: true,
        elevations: true,
        ascentM: true,
        descentM: true,
        movingSeconds: true,
      },
    });
    const previous = { ...before, sourceUrl } as unknown as Prisma.InputJsonValue;
    await tx.tripRouteTrack.update({ where: { id: row.id }, data: columns });
    await record(tx, { routeTrackId: row.id }, row, "remeasured", now, previous);
  });
  return true;
}

async function remeasureCruiseTrack(
  row: Candidate & { cruiseId: string },
  parsed: ParsedTrack,
  sourceUrl: string,
  now: Date
): Promise<boolean> {
  const ingested = ingestTrack(prepareCruiseTrack(parsed));
  if (!ingested) return false;
  const { startedAt: _s, endedAt: _e, ...columns } = cruiseTrackColumns(ingested);
  await prisma.$transaction(
    async (tx) => {
      const before = await tx.cruiseTrack.findUniqueOrThrow({
        where: { id: row.id },
        select: {
          geometry: true,
          segmentStarts: true,
          cumulativeKm: true,
          pointCount: true,
          distanceKm: true,
        },
      });
      const previous = { ...before, sourceUrl } as unknown as Prisma.InputJsonValue;
      const snapshot = await shareSnapshot(tx, "cruise", row.cruiseId);
      await tx.cruiseTrack.update({ where: { id: row.id }, data: columns });
      await recomputeLegsForCruise(row.cruiseId, tx);
      await propagateWrite(tx, row.userId, "cruise", row.cruiseId, snapshot);
      await record(tx, { cruiseTrackId: row.id }, row, "remeasured", now, previous);
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
  return true;
}

async function candidates(
  limit: number,
  attempted: ReadonlySet<string>,
  tripped: ReadonlySet<string>,
  now: Date
) {
  const due = {
    OR: [
      { jitterRemeasure: { is: null } },
      { jitterRemeasure: { is: { nextAttemptAt: { lte: now } } } },
    ],
  };
  const base = {
    source: "dawarich",
    jitterDropped: null,
    truncated: false,
    id: { notIn: [...attempted] },
  };
  const select = {
    id: true,
    startedAt: true,
    endedAt: true,
    pointCount: true,
    geometry: true,
    jitterRemeasure: { select: { attempts: true } },
  } as const;
  const tours = await prisma.tripRouteTrack.findMany({
    where: { ...base, ...due, route: { userId: { notIn: [...tripped] } } },
    orderBy: { id: "asc" },
    take: limit,
    select: { ...select, route: { select: { userId: true, mode: true, activity: true } } },
  });
  const cruises = await prisma.cruiseTrack.findMany({
    where: { ...base, ...due, cruise: { userId: { notIn: [...tripped] } } },
    orderBy: { id: "asc" },
    take: Math.max(0, limit - tours.length),
    select: { ...select, cruiseId: true, cruise: { select: { userId: true } } },
  });
  return {
    tours: tours.map(({ route, jitterRemeasure, ...t }) => ({
      ...t,
      ...route,
      attempts: jitterRemeasure?.attempts ?? 0,
    })),
    cruises: cruises.map(({ cruise, jitterRemeasure, ...c }) => ({
      ...c,
      userId: cruise.userId,
      attempts: jitterRemeasure?.attempts ?? 0,
    })),
  };
}

/** One bounded pass. */
export async function remeasureStoredTracks(options: RemeasureOptions): Promise<RemeasureReport> {
  const clientFor = options.clientFor ?? defaultClientFor;
  const now = options.now?.() ?? new Date();
  const tripped = options.trippedUsers ?? new Set<string>();
  const report: RemeasureReport = {
    remeasured: 0,
    skipped: { notConfigured: 0, sourceChanged: 0, unavailable: 0 },
    examined: 0,
  };
  const { tours, cruises } = await candidates(options.limit, options.attempted, tripped, now);
  const sources = new Map<string, DawarichSource | null>();
  const failuresInARow = options.failuresInARow ?? new Map<string, number>();

  const attempt = async <R extends Candidate>(
    row: R,
    key: { routeTrackId: string } | { cruiseTrackId: string },
    write: (row: R, parsed: ParsedTrack, sourceUrl: string, now: Date) => Promise<boolean>
  ) => {
    if (tripped.has(row.userId)) return;
    options.attempted.add(row.id);
    report.examined += 1;
    if (!sources.has(row.userId)) sources.set(row.userId, await clientFor(row.userId));
    const source = sources.get(row.userId);
    if (!source) {
      report.skipped.notConfigured += 1;
      await record(prisma, key, row, "notConfigured", now);
      return;
    }
    try {
      const parsed = await pullSameRecording(source.client, row);
      failuresInARow.set(row.userId, 0);
      if (parsed && (await write(row, parsed, source.sourceUrl, now))) {
        report.remeasured += 1;
      } else {
        report.skipped.sourceChanged += 1;
        await record(prisma, key, row, "sourceChanged", now);
      }
    } catch (error) {
      if (!(error instanceof DawarichError)) throw error;
      report.skipped.unavailable += 1;
      await record(prisma, key, row, "unavailable", now);
      const failures = (failuresInARow.get(row.userId) ?? 0) + 1;
      failuresInARow.set(row.userId, failures);
      if (failures >= BREAKER_FAILURES) tripped.add(row.userId);
      logger.warn({
        operation: "track.jitter.remeasure.unavailable",
        trackId: row.id,
        kind: error.kind,
        breakerOpen: failures >= BREAKER_FAILURES,
      });
    }
  };

  for (const row of tours) await attempt(row, { routeTrackId: row.id }, remeasureTourTrack);
  for (const row of cruises) await attempt(row, { cruiseTrackId: row.id }, remeasureCruiseTrack);
  return report;
}
