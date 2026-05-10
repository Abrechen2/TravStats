/**
 * One-shot backfill for issue #106 (RC4) — runs in two independent passes:
 *
 *   A) airlineIata / airlineIcao normalisation
 *      For every flight with a free-text `airline` set but missing IATA/ICAO
 *      codes, resolve via the static lookup (utils/airlineNormalize) and
 *      fill in the codes. Runs against `operating_airline*` too so codeshare
 *      detection has both sides.
 *
 *   B) (no-op DB write) durationMinutes for DATE_ONLY rows is computed on
 *      the fly in flights.ts; nothing to backfill there. We still emit a
 *      count so operators see how many rows the new return-null path
 *      affects on their host.
 *
 * Why this exists
 * ---------------
 * Hosts that already have manually-entered DATE_ONLY flights (jay-tau,
 * nowi57, Norbert) need:
 *   - Their existing "Iberia" / "Lufthansa" rows to gain IATA/ICAO so the
 *     airline-filter sidebar groups them properly.
 *   - The display layer to stop reporting fictional 0 / -120 / +120 min
 *     durations (handled automatically by the route patch — no DB write).
 *
 * Idempotency
 * -----------
 *   Pass A skips any row where airlineIata is already non-null, so it's
 *   safe to re-run after each deploy.
 *
 * Usage
 * -----
 *   # Local dev:
 *   DATABASE_URL=postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev \
 *     npx tsx backend/scripts/backfillDataIntegrityRc4.ts
 *
 *   # On a host (CT 100 prod / Norberts Unraid-2 / …):
 *   docker exec TravStats npx tsx /app/backend/scripts/backfillDataIntegrityRc4.ts
 *
 *   Add --dry-run to preview without writing.
 */

import { PrismaClient } from '@prisma/client';
import { resolveAirlineCodes } from '../src/utils/airlineNormalize';

interface Args {
  dryRun: boolean;
  batchSize: number;
}

function parseArgs(argv: string[]): Args {
  return {
    dryRun: argv.includes('--dry-run'),
    batchSize: Number(argv.find((a) => a.startsWith('--batch-size='))?.split('=')[1]) || 500,
  };
}

interface PassAResult {
  candidatesAirline: number;
  updatedAirline: number;
  candidatesOperating: number;
  updatedOperating: number;
  unresolved: string[];
}

async function passAirlineCodes(
  prisma: PrismaClient,
  args: Args,
): Promise<PassAResult> {
  const candidatesAirline = await prisma.flight.findMany({
    where: { airline: { not: null }, airlineIata: null },
    select: { id: true, airline: true },
  });

  const candidatesOperating = await prisma.flight.findMany({
    where: { operatingAirline: { not: null }, operatingAirlineIata: null },
    select: { id: true, operatingAirline: true },
  });

  let updatedAirline = 0;
  let updatedOperating = 0;
  const unresolved = new Set<string>();

  if (!args.dryRun) {
    for (const f of candidatesAirline) {
      const resolved = resolveAirlineCodes(f.airline ?? '');
      if (!resolved) {
        if (f.airline) unresolved.add(f.airline);
        continue;
      }
      await prisma.flight.update({
        where: { id: f.id },
        data: {
          airlineIata: resolved.iata,
          airlineIcao: resolved.icao ?? null,
        },
      });
      updatedAirline++;
    }

    for (const f of candidatesOperating) {
      const resolved = resolveAirlineCodes(f.operatingAirline ?? '');
      if (!resolved) {
        if (f.operatingAirline) unresolved.add(f.operatingAirline);
        continue;
      }
      await prisma.flight.update({
        where: { id: f.id },
        data: {
          operatingAirlineIata: resolved.iata,
          operatingAirlineIcao: resolved.icao ?? null,
        },
      });
      updatedOperating++;
    }
  } else {
    for (const f of candidatesAirline) {
      const r = resolveAirlineCodes(f.airline ?? '');
      if (r) updatedAirline++;
      else if (f.airline) unresolved.add(f.airline);
    }
    for (const f of candidatesOperating) {
      const r = resolveAirlineCodes(f.operatingAirline ?? '');
      if (r) updatedOperating++;
      else if (f.operatingAirline) unresolved.add(f.operatingAirline);
    }
  }

  return {
    candidatesAirline: candidatesAirline.length,
    updatedAirline,
    candidatesOperating: candidatesOperating.length,
    updatedOperating,
    unresolved: Array.from(unresolved).sort(),
  };
}

interface PassBResult {
  dateOnlyRows: number;
}

async function passDateOnlyCount(prisma: PrismaClient): Promise<PassBResult> {
  const dateOnlyRows = await prisma.flight.count({
    where: {
      OR: [
        { depTimeSemantics: 'DATE_ONLY' },
        { arrTimeSemantics: 'DATE_ONLY' },
      ],
    },
  });
  return { dateOnlyRows };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  console.log(`[backfill-rc4] mode=${args.dryRun ? 'dry-run' : 'apply'} batchSize=${args.batchSize}`);

  try {
    const a = await passAirlineCodes(prisma, args);
    console.log(`[backfill-rc4] pass A — airline codes`);
    console.log(`  airline:           ${a.candidatesAirline} candidates → ${a.updatedAirline} resolved`);
    console.log(`  operatingAirline:  ${a.candidatesOperating} candidates → ${a.updatedOperating} resolved`);
    if (a.unresolved.length > 0) {
      console.log(`  unresolved (${a.unresolved.length}, add to NAME_TO_IATA if needed):`);
      for (const name of a.unresolved.slice(0, 20)) console.log(`    - "${name}"`);
      if (a.unresolved.length > 20) console.log(`    … and ${a.unresolved.length - 20} more`);
    }

    const b = await passDateOnlyCount(prisma);
    console.log(`[backfill-rc4] pass B — DATE_ONLY rows: ${b.dateOnlyRows}`);
    console.log(`  (no DB write — durationMinutes is computed on read; the new`);
    console.log(`   tzAwareDurationMinutes path returns null for these rows)`);

    console.log(`[backfill-rc4] done.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[backfill-rc4] FAILED:', err);
  process.exit(1);
});
