/**
 * One-shot backfill script: populate `co2_kg` for every flight that has
 * dep/arr coordinates but a NULL CO2 value, using the same model the API
 * writes on insert (`calculateCo2Kg` — distance band + cabin-class factor).
 *
 * Why this exists
 * ---------------
 * `co2Kg` is only stamped at flight create/update time. Flights logged
 * before the CO2 feature existed — or mass-imported from old logbooks /
 * Excel uploads where the write path didn't run — have a NULL `co2_kg`,
 * so the flight list silently omits their footprint and the dashboard
 * aggregate undercounts. This back-populates them in one pass so every
 * flight with coordinates carries a consistent figure.
 *
 * Idempotency
 * -----------
 * Already-populated rows are skipped via `where: { co2Kg: null }`. Running
 * it twice is a no-op (zero rows updated on the second run).
 *
 * Usage
 * -----
 *   # Locally (dev DB):
 *   DATABASE_URL=postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev \
 *     npx tsx backend/scripts/backfillCo2.ts
 *
 *   # On a host (CT 100, …), the script ships inside the image:
 *   docker exec TravStats npx tsx /app/backend/scripts/backfillCo2.ts
 *
 * Env / args
 * ----------
 *   DATABASE_URL   Postgres connection string (required, read by Prisma).
 *   --dry-run      Count candidates and print what WOULD be updated, but
 *                  don't write. Default: false.
 *   --batch-size   Rows per UPDATE batch. Default: 500.
 */

import { PrismaClient } from "@prisma/client";
import { calculateCo2Kg, toSeatClass } from "../src/services/co2Calculator";

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
  depLat: number | null;
  depLon: number | null;
  arrLat: number | null;
  arrLon: number | null;
  seatClass: string | null;
}

async function backfillCo2(
  prisma: PrismaClient,
  args: BackfillArgs,
): Promise<{ scanned: number; updated: number; skipped: number }> {
  const candidates = (await prisma.flight.findMany({
    where: { co2Kg: null },
    select: {
      id: true,
      depLat: true,
      depLon: true,
      arrLat: true,
      arrLon: true,
      seatClass: true,
    },
  })) as CandidateFlight[];

  let updated = 0;
  let skipped = 0;
  const updates: Array<{ id: string; co2Kg: number }> = [];

  for (const f of candidates) {
    const co2 = calculateCo2Kg({
      depLat: f.depLat,
      depLon: f.depLon,
      arrLat: f.arrLat,
      arrLon: f.arrLon,
      seatClass: toSeatClass(f.seatClass),
    });
    // Missing coords → calculateCo2Kg returns null; nothing we can fill.
    if (co2 === null) {
      skipped += 1;
      continue;
    }
    updates.push({ id: f.id, co2Kg: co2 });
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
          data: { co2Kg: u.co2Kg },
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
    const result = await backfillCo2(prisma, args);
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

export { backfillCo2 };
