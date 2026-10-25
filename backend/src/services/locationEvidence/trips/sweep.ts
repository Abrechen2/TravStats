/**
 * Trip inference for every TravTrack account (TravTrack plan L4), run nightly
 * by `jobs/travTrackTripScheduler.ts`. Every account whose location provider
 * is TravTrack is asked about the last 60 finished days (`suggestTrips`).
 * Nothing runs while the instance's TravTrack is off; Dawarich accounts are
 * never selected (open owner decision (c)). One account's failure is logged
 * and stops no other.
 *
 * Bounded (Codex review of L4, P3): a run never overlaps the previous one in
 * this process (single flight — the server runs as one process, like the
 * projection scheduler), and takes at most `TRIP_ACCOUNTS_PER_RUN` accounts,
 * the least recently scanned first (`trip_scanned_at`), so a large instance
 * spreads its accounts over several nights instead of reading every history
 * in one. Each account read is itself bounded by the derivation read's cap.
 */
import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { travTrackInstanceOn } from "../../travtrack/availability";
import { suggestTrips } from "./suggest";

export const TRIP_ACCOUNTS_PER_RUN = 50;

let running = false;

export type TripSweepResult = { status: "done" | "off" | "overlap"; accounts: number };

/** The TravTrack accounts to take, least recently scanned (or never) first. */
async function accountsToScan(limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ user_id: string }[]>`
    SELECT us.user_id FROM user_settings us
      LEFT JOIN travtrack_derivation_state s ON s.user_id = us.user_id
     WHERE us.location_provider = 'travtrack'
     ORDER BY s.trip_scanned_at ASC NULLS FIRST, us.user_id
     LIMIT ${limit}`;
  return rows.map((r) => r.user_id);
}

export async function runTravTrackTripSweep(
  nowMs?: number,
  opts: { maxAccounts?: number } = {}
): Promise<TripSweepResult> {
  if (running) return { status: "overlap", accounts: 0 };
  running = true;
  try {
    if (!(await travTrackInstanceOn())) return { status: "off", accounts: 0 };
    const accounts = await accountsToScan(opts.maxAccounts ?? TRIP_ACCOUNTS_PER_RUN);
    for (const userId of accounts) {
      try {
        const result = await suggestTrips(userId, { nowMs });
        if (result.status !== "done") {
          logger.info({ operation: "travtrack_trips_not_run", userId, ...result });
        }
      } catch (error) {
        logger.error({ operation: "travtrack_trips_failed", userId, error }, "Trip scan failed");
      }
      // Taken, whatever came of it: a failing account does not hold the queue.
      const at = new Date();
      await prisma.travTrackDerivationState.upsert({
        where: { userId },
        create: { userId, tripScannedAt: at },
        update: { tripScannedAt: at },
      });
    }
    return { status: "done", accounts: accounts.length };
  } finally {
    running = false;
  }
}
