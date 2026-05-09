/**
 * One-shot backfill script: populate `route_distance` for every flight that
 * has dep/arr coordinates but a NULL distance, using the same Haversine
 * formula the API now writes on insert.
 *
 * Why this exists
 * ---------------
 * Until v1.5.0-rc.3, `route_distance` was only filled by Provider lookups
 * (AeroDataBox / AirLabs). Hosts whose users mass-imported old logbook
 * data — or where an AI agent batch-uploaded an Excel — had hundreds of
 * NULL distances, breaking "total km", "longest flight", and the
 * distance-tier achievements. This script back-populates them in one pass.
 *
 * Idempotency
 * -----------
 * Already-populated rows are skipped via `where: { routeDistance: null }`.
 * Running it twice is a no-op (zero rows updated on the second run).
 *
 * Usage
 * -----
 *   # Locally (dev DB):
 *   DATABASE_URL=postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev \
 *     npx tsx backend/scripts/backfillRouteDistance.ts
 *
 *   # On a host (CT 100, Norberts Unraid-2, …):
 *   docker exec TravStats node -e "
 *     require('child_process').execSync(
 *       'npx tsx /app/backend/scripts/backfillRouteDistance.ts',
 *       { stdio: 'inherit' }
 *     )
 *   "
 *
 *   Or, if the script is shipped into the image (it is, since v1.5.0-rc.3):
 *   docker exec TravStats npx tsx /app/backend/scripts/backfillRouteDistance.ts
 *
 * Env / args
 * ----------
 *   DATABASE_URL   Postgres connection string (required, read by Prisma).
 *   --dry-run      Count candidates and print what WOULD be updated, but
 *                  don't write. Default: false.
 *   --batch-size   Rows per UPDATE batch. Default: 500. Lower if your
 *                  Postgres has tight statement-timeout settings.
 */

import { PrismaClient } from "@prisma/client";
import { haversineKm } from "../src/services/co2Calculator";

interface BackfillArgs {
  dryRun: boolean;
  batchSize: number;
}

function parseArgs(argv: string[]): BackfillArgs {
  const args: BackfillArgs = { dryRun: false, batchSize: 500 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    if (a === "--batch-size") {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0 && n <= 5000) args.batchSize = n;
    }
  }
  return args;
}

interface CandidateFlight {
  id: string;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
}

async function backfillRouteDistance(
  prisma: PrismaClient,
  args: BackfillArgs,
): Promise<{ scanned: number; updated: number; skipped: number }> {
  const candidates = (await prisma.flight.findMany({
    where: { routeDistance: null },
    select: { id: true, depLat: true, depLon: true, arrLat: true, arrLon: true },
  })) as CandidateFlight[];

  let updated = 0;
  let skipped = 0;
  const updates: Array<{ id: string; routeDistance: number }> = [];

  for (const f of candidates) {
    if (
      f.depLat == null ||
      f.depLon == null ||
      f.arrLat == null ||
      f.arrLon == null
    ) {
      skipped += 1;
      continue;
    }
    const km = haversineKm(f.depLat, f.depLon, f.arrLat, f.arrLon);
    if (!Number.isFinite(km) || km <= 0) {
      skipped += 1;
      continue;
    }
    updates.push({ id: f.id, routeDistance: Math.round(km * 100) / 100 });
  }

  if (args.dryRun) {
    return { scanned: candidates.length, updated: updates.length, skipped };
  }

  for (let i = 0; i < updates.length; i += args.batchSize) {
    const batch = updates.slice(i, i + args.batchSize);
    await prisma.$transaction(
      batch.map((u) =>
        prisma.flight.update({
          where: { id: u.id },
          data: { routeDistance: u.routeDistance },
        }),
      ),
    );
    updated += batch.length;
  }

  return { scanned: candidates.length, updated, skipped };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const start = Date.now();
    const result = await backfillRouteDistance(prisma, args);
    const ms = Date.now() - start;
    process.stdout.write(
      JSON.stringify(
        {
          mode: args.dryRun ? "dry-run" : "apply",
          batchSize: args.batchSize,
          scanned: result.scanned,
          updated: result.updated,
          skipped: result.skipped,
          elapsedMs: ms,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`backfill failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}

export { backfillRouteDistance };
