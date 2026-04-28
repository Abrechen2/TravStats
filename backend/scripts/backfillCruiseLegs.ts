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
 *   `npx tsx scripts/backfillCruiseLegs.ts --apply`  → write changes
 *   `npx tsx scripts/backfillCruiseLegs.ts`          → dry-run summary
 *
 * Auto-runs at container boot via docker-entrypoint.sh when the env
 * flag `CRUISE_LEGS_AUTO_BACKFILL` is unset or "true". Set to "false"
 * to skip — same pattern as TIMESEMANTICS_AUTO_BACKFILL.
 */

import { prisma } from "../src/db";
import {
  recomputeLegsForCruise,
  ORCHESTRATOR_VERSION,
} from "../src/services/cruiseDistance/cruiseLegService";

interface BackfillStats {
  scanned: number;
  upToDate: number;
  recomputed: number;
  failed: number;
  zeroLegCruises: number;
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
      stops: {
        where: { isAtSea: false, portId: { not: null } },
        select: { id: true },
      },
      legs: { select: { routerVersion: true } },
    },
  });

  for (const cruise of cruises) {
    stats.scanned += 1;
    const portCallCount = cruise.stops.length;
    const expectedLegs = Math.max(0, portCallCount - 1);
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

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  void prisma.$disconnect().finally(() => process.exit(1));
});
