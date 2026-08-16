/**
 * Backfill / refresh persisted cruise-leg distances.
 *
 * Idempotent. Safe to run repeatedly. Recomputes legs for:
 *   - cruises that have no rows in `cruise_legs` at all (newly imported,
 *     or pre-existing data from before Phase 1 shipped)
 *   - cruises whose existing legs were computed by a stale orchestrator
 *     (router_version mismatch with the current orchestrator)
 *   - cruises whose stop count and leg count are inconsistent (e.g.
 *     stops were edited and the recompute trigger somehow missed)
 *
 * Run modes:
 *   `npx tsx src/scripts/backfillCruiseLegs.ts --apply`  → write changes
 *   `npx tsx src/scripts/backfillCruiseLegs.ts`          → dry-run summary
 *
 * Auto-runs at container boot via docker-entrypoint.sh when the env
 * flag `CRUISE_LEGS_AUTO_BACKFILL` is unset or "true". Set to "false"
 * to skip — same pattern as TIMESEMANTICS_AUTO_BACKFILL.
 */

import { prisma } from "../db";
import {
  recomputeLegsForCruise,
  ORCHESTRATOR_VERSION,
} from "../services/cruiseDistance/cruiseLegService";
import { buildEffectivePortSequence } from "../shared/cruise/portSequence";

interface BackfillStats {
  scanned: number;
  upToDate: number;
  recomputed: number;
  failed: number;
  zeroLegCruises: number;
}

export interface ExpectedLegInput {
  departurePortId: number | null;
  arrivalPortId: number | null;
  /** Port-call stops in itinerary order (sea days already excluded). */
  stops: Array<{ portId: number | null }>;
}

/**
 * How many legs `recomputeLegsForCruise` will produce for this cruise.
 *
 * Must use the SAME sequence rule as the recompute, which is why it goes
 * through `buildEffectivePortSequence`. The previous `portCallCount - 1`
 * ignored the departure and arrival ports — those live on the cruise row, not
 * in `cruise_stops` — so this script judged correct cruises to be out of date
 * and would have been the wrong ruler for any migration that trusted it.
 */
export function expectedLegCount(cruise: ExpectedLegInput): number {
  const portCalls = cruise.stops
    .filter((s): s is { portId: number } => s.portId !== null)
    .map((s) => ({ id: s.portId }));
  const sequence = buildEffectivePortSequence(
    cruise.departurePortId !== null ? { id: cruise.departurePortId } : null,
    portCalls,
    cruise.arrivalPortId !== null ? { id: cruise.arrivalPortId } : null,
  );
  return Math.max(0, sequence.length - 1);
}

async function backfill(apply: boolean): Promise<BackfillStats> {
  const stats: BackfillStats = {
    scanned: 0,
    upToDate: 0,
    recomputed: 0,
    failed: 0,
    zeroLegCruises: 0,
  };

  const cruises = await prisma.cruise.findMany({
    select: {
      id: true,
      departurePortId: true,
      arrivalPortId: true,
      stops: {
        where: { isAtSea: false, portId: { not: null } },
        orderBy: { dayNumber: "asc" },
        select: { portId: true },
      },
      legs: { select: { routerVersion: true } },
    },
  });

  for (const cruise of cruises) {
    stats.scanned += 1;
    const expectedLegs = expectedLegCount(cruise);
    const haveLegs = cruise.legs.length;

    if (expectedLegs === 0) {
      stats.zeroLegCruises += 1;
      continue;
    }

    const lengthMatches = haveLegs === expectedLegs;
    const versionMatches =
      haveLegs > 0 && cruise.legs.every((l) => l.routerVersion === ORCHESTRATOR_VERSION);

    if (lengthMatches && versionMatches) {
      stats.upToDate += 1;
      continue;
    }

    if (!apply) {
      stats.recomputed += 1;
      continue;
    }

    try {
      await recomputeLegsForCruise(cruise.id);
      stats.recomputed += 1;
    } catch (err) {
      stats.failed += 1;
      console.error(
        `[backfill] cruise ${cruise.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return stats;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`[backfill] mode=${apply ? "APPLY" : "dry-run"} orchestrator=${ORCHESTRATOR_VERSION}`);
  const stats = await backfill(apply);
  console.log("[backfill] result:", stats);
  await prisma.$disconnect();
}

// Only run when invoked as a script. Without this guard, importing the module
// (a unit test does) would execute the backfill against the live database.
// Same pattern as scripts/recheckAchievements.ts.
if (require.main === module) {
  main().catch((err) => {
    console.error("[backfill] fatal:", err);
    void prisma.$disconnect().finally(() => process.exit(1));
  });
}
