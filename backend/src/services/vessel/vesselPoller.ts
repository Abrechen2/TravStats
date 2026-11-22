import { prisma } from "../../db";
import logger from "../../utils/logger";
import { aisConfigured, lookupVessel, type AisResult } from "../ferry/aisStream";
import { egressBlock } from "../externalServices/egress";
import { offReasonFor } from "../externalServices/policy";
import { rebuildCruiseAisTrack } from "./cruiseAisTrack";
import {
  adoptFerryTrackDistance,
  ensureVesselMmsi,
  IN_PROGRESS_MARGIN_MS,
  isInProgress,
  loadFixes,
  loadVesselJourney,
  storeFix,
  trackFromFixes,
  type VesselJourney,
} from "./vesselJourney";
import { AIS_SERVICE } from "./vesselResolver";

/**
 * The vessel poller (2026-11-22): for every ferry crossing and cruise in
 * progress, resolve the ship's MMSI if none is bound and read one AIS position
 * into the journey's recorded track. Each journey is its own account's: the
 * account's switches apply, and a fix is stored only on that account's row.
 *
 * Within the provider's limits: the poller reads one vessel at a time under its
 * own socket slot (`lookupVessel`'s per-account guard), at most `MAX_PER_TICK`
 * journeys per run, and one read per MMSI per run however many accounts share
 * the ship. Out of terrestrial range is the normal case at sea — the read then
 * ends as `noSignal` and nothing is stored.
 */

/** The poller's own account key for the socket guard: one socket, never two. */
const POLLER_ACCOUNT = "vessel-poller";
export const MAX_PER_TICK = 30;
/** Journeys read per run before the in-progress check; a storage bound, not a quota. */
const MAX_CANDIDATES = 500;
/** Where the next run starts in the candidate list, so more than `MAX_PER_TICK` journeys take turns. */
let cursor = 0;
const FERRY_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const CRUISE_LOOKBACK_MS = 40 * 24 * 60 * 60 * 1000;

export interface PollReport {
  skipped?: "notConfigured" | "blocked";
  journeys: number;
  stored: number;
  noSignal: number;
  unresolved: number;
}

async function candidates(
  now: Date
): Promise<Array<{ kind: "ferry" | "cruise"; id: string; userId: string }>> {
  const soon = new Date(now.getTime() + IN_PROGRESS_MARGIN_MS);
  const [ferries, cruises] = await Promise.all([
    prisma.ferryJourney.findMany({
      where: {
        status: { not: "cancelled" },
        departureTime: { lte: soon, gte: new Date(now.getTime() - FERRY_LOOKBACK_MS) },
        // Arrived crossings out in the query, so they cannot crowd out the ones at sea.
        OR: [
          { arrivalTime: null },
          { arrivalTime: { gte: new Date(now.getTime() - IN_PROGRESS_MARGIN_MS) } },
        ],
      },
      select: { id: true, userId: true },
      orderBy: { id: "asc" },
      take: MAX_CANDIDATES,
    }),
    prisma.cruise.findMany({
      where: {
        status: { not: "cancelled" },
        startDate: { lte: soon, gte: new Date(now.getTime() - CRUISE_LOOKBACK_MS) },
        endDate: { gte: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) },
      },
      select: { id: true, userId: true },
      orderBy: { id: "asc" },
      take: MAX_CANDIDATES,
    }),
  ]);
  return [
    ...ferries.map((f) => ({ kind: "ferry" as const, ...f })),
    ...cruises.map((c) => ({ kind: "cruise" as const, ...c })),
  ];
}

async function afterFix(j: VesselJourney): Promise<void> {
  const fixes = await loadFixes(j);
  if (j.kind === "cruise") {
    await rebuildCruiseAisTrack(j.id, j.userId, fixes);
    return;
  }
  const track = trackFromFixes(fixes, j);
  if (track) await adoptFerryTrackDistance(j, track);
}

export async function pollVesselsOnce(
  now = new Date(),
  read: (mmsi: string) => Promise<AisResult> = (mmsi) => lookupVessel(mmsi, POLLER_ACCOUNT)
): Promise<PollReport> {
  const report: PollReport = { journeys: 0, stored: 0, noSignal: 0, unresolved: 0 };
  if (!aisConfigured()) return { ...report, skipped: "notConfigured" };
  if ((await egressBlock(AIS_SERVICE)) !== null) return { ...report, skipped: "blocked" };
  const reads = new Map<string, AisResult>();
  const all = await candidates(now);
  const start = all.length > 0 ? cursor % all.length : 0;
  const turn = [...all.slice(start), ...all.slice(0, start)];
  cursor = start + MAX_PER_TICK;
  for (const c of turn) {
    if (report.journeys >= MAX_PER_TICK) break;
    const j = await loadVesselJourney(c.kind, c.id, c.userId);
    if (!j || !isInProgress(j, now)) continue;
    if ((await offReasonFor(AIS_SERVICE, j.userId)) !== null) continue;
    report.journeys += 1;
    try {
      const { mmsi } = await ensureVesselMmsi(j, now);
      if (!mmsi) {
        report.unresolved += 1;
        continue;
      }
      let result = reads.get(mmsi);
      if (!result) {
        result = await read(mmsi);
        reads.set(mmsi, result);
      }
      if (result.status !== "ok") {
        report.noSignal += 1;
        continue;
      }
      if (await storeFix({ ...j, mmsi }, result.position)) {
        report.stored += 1;
        await afterFix(j);
      }
    } catch (error) {
      // One journey's failure must not end the run for the others.
      logger.warn({
        operation: "vessel.poll.failed",
        kind: j.kind,
        id: j.id,
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
  }
  if (report.journeys > 0) logger.info({ operation: "vessel.poll", ...report });
  return report;
}
