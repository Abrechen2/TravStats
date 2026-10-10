import { prisma } from "../../db";
import { NIGHTLY_WINDOW_DAYS, nextNightlyRunAt } from "./nightlySchedule";
import { getImmichConnection } from "../immich/immichResolver";

/**
 * What `GET`/`PUT /photo-journeys/settings` answer (forgejo#94, point 1): the
 * opt-in, and everything the settings card needs to say what it does.
 *
 * `immichConnected` is the scan's own first question (`getImmichConnection`),
 * so "the switch is on but nothing will run" is said, not discovered. It is
 * null for the shared demo account and for an account with no connection.
 */
export interface NightlyScanView {
  nightlyScan: boolean;
  immichConnected: boolean;
  windowDays: number;
  nextRunAt: string;
  lastRun: {
    ranAt: string;
    result: "scanned" | "noImmich" | "failed";
    created: number | null;
    failure: string | null;
  } | null;
}

const RESULTS = new Set(["scanned", "noImmich", "failed"]);

export async function nightlyScanView(userId: string, now = new Date()): Promise<NightlyScanView> {
  const [row, connection] = await Promise.all([
    prisma.userSettings.findUnique({
      where: { userId },
      select: {
        photoJourneyNightlyScan: true,
        photoJourneyLastScanAt: true,
        photoJourneyLastScanResult: true,
        photoJourneyLastScanFailure: true,
        photoJourneyLastScanCreated: true,
      },
    }),
    getImmichConnection(userId),
  ]);
  const result = row?.photoJourneyLastScanResult;
  const lastRun =
    row?.photoJourneyLastScanAt && result && RESULTS.has(result)
      ? {
          ranAt: row.photoJourneyLastScanAt.toISOString(),
          result: result as "scanned" | "noImmich" | "failed",
          created: row.photoJourneyLastScanCreated,
          failure: row.photoJourneyLastScanFailure,
        }
      : null;
  return {
    nightlyScan: row?.photoJourneyNightlyScan ?? false,
    immichConnected: connection !== null,
    windowDays: NIGHTLY_WINDOW_DAYS,
    nextRunAt: nextNightlyRunAt(now).toISOString(),
    lastRun,
  };
}
