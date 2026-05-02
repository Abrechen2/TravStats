/**
 * Backfill script for the canonical-UTC migration.
 *
 * Classifies every flight whose dep_time_semantics/arr_time_semantics is still
 * 'UNKNOWN' by inspecting `dataSource`, and for legacy entries converts the
 * stored fake-UTC timestamps into real UTC in place.
 *
 * Modes:
 *   tsx src/scripts/backfillTimeSemantics.ts            # dry-run (default)
 *   tsx src/scripts/backfillTimeSemantics.ts --apply    # write changes
 *
 * Heuristic:
 *   dataSource='api_lookup' | 'live_update' | 'historical_enrichment'
 *     → 'UTC' (timestamps already real UTC, leave unchanged)
 *   dataSource='manual' | 'email_import' | 'boarding_pass_scan'
 *     → 'LEGACY_FAKE_UTC' (convert stored fake-UTC → real UTC via airport tz)
 *   dataSource=null or anything else
 *     → stays 'UNKNOWN' (no automated decision; user reviews manually)
 *
 * Conversion failures (missing airport tz, missing IATA, parse errors) leave
 * the row as 'UNKNOWN' and are logged so they can be inspected.
 */

import { prisma } from '../db';
import { legacyFakeUtcToRealUtc } from '../utils/timezone';
import { getCachedAirport } from '../services/airportCache';
import logger from '../utils/logger';

const UTC_SOURCES = new Set(['api_lookup', 'live_update', 'historical_enrichment']);
const LEGACY_SOURCES = new Set(['manual', 'email_import', 'boarding_pass_scan']);

type Side = 'dep' | 'arr';

interface SideStats {
  utc: number;
  legacyConverted: number;
  legacySkipped: number;
  unknownLeft: number;
}

interface BackfillReport {
  total: number;
  bySource: Record<string, number>;
  dep: SideStats;
  arr: SideStats;
  errors: number;
}

function emptyStats(): SideStats {
  return { utc: 0, legacyConverted: 0, legacySkipped: 0, unknownLeft: 0 };
}

async function resolveTz(iata: string | null): Promise<string | null> {
  if (!iata) return null;
  try {
    const airport = await getCachedAirport(iata);
    return airport?.timezone ?? null;
  } catch {
    return null;
  }
}

interface SidePlan {
  semantics: 'UTC' | 'LEGACY_FAKE_UTC' | 'UNKNOWN';
  newValue: Date | null;
}

async function planSide(
  source: string | null,
  storedValue: Date | null,
  iata: string | null,
  side: Side,
  flightId: string,
  stats: SideStats,
): Promise<SidePlan> {
  if (source && UTC_SOURCES.has(source)) {
    stats.utc += 1;
    return { semantics: 'UTC', newValue: storedValue };
  }

  if (source && LEGACY_SOURCES.has(source)) {
    if (!storedValue) {
      stats.legacyConverted += 1;
      return { semantics: 'LEGACY_FAKE_UTC', newValue: null };
    }
    const tz = await resolveTz(iata);
    if (!tz) {
      stats.legacySkipped += 1;
      logger.warn({
        operation: 'backfill_skip_legacy_no_tz',
        flightId,
        side,
        iata,
      });
      return { semantics: 'UNKNOWN', newValue: storedValue };
    }
    try {
      const realUtc = legacyFakeUtcToRealUtc(storedValue, tz);
      stats.legacyConverted += 1;
      return { semantics: 'LEGACY_FAKE_UTC', newValue: realUtc };
    } catch (err) {
      stats.legacySkipped += 1;
      logger.warn({
        operation: 'backfill_legacy_conversion_failed',
        flightId,
        side,
        iata,
        tz,
        error: err instanceof Error ? err.message : 'unknown',
      });
      return { semantics: 'UNKNOWN', newValue: storedValue };
    }
  }

  stats.unknownLeft += 1;
  return { semantics: 'UNKNOWN', newValue: storedValue };
}

async function run(apply: boolean): Promise<BackfillReport> {
  const flights = await prisma.flight.findMany({
    where: {
      OR: [{ depTimeSemantics: 'UNKNOWN' }, { arrTimeSemantics: 'UNKNOWN' }],
    },
    select: {
      id: true,
      dataSource: true,
      depIata: true,
      arrIata: true,
      departureTime: true,
      arrivalTime: true,
      depTimeSemantics: true,
      arrTimeSemantics: true,
    },
  });

  const report: BackfillReport = {
    total: flights.length,
    bySource: {},
    dep: emptyStats(),
    arr: emptyStats(),
    errors: 0,
  };

  for (const f of flights) {
    const sourceKey = f.dataSource ?? '<null>';
    report.bySource[sourceKey] = (report.bySource[sourceKey] ?? 0) + 1;

    const depPlan =
      f.depTimeSemantics === 'UNKNOWN'
        ? await planSide(f.dataSource, f.departureTime, f.depIata, 'dep', f.id, report.dep)
        : null;
    const arrPlan =
      f.arrTimeSemantics === 'UNKNOWN'
        ? await planSide(f.dataSource, f.arrivalTime, f.arrIata, 'arr', f.id, report.arr)
        : null;

    if (!apply) continue;

    const update: Record<string, unknown> = {};
    if (depPlan) {
      update.depTimeSemantics = depPlan.semantics;
      if (depPlan.semantics === 'LEGACY_FAKE_UTC' && depPlan.newValue) {
        update.departureTime = depPlan.newValue;
      }
    }
    if (arrPlan) {
      update.arrTimeSemantics = arrPlan.semantics;
      if (arrPlan.semantics === 'LEGACY_FAKE_UTC' && arrPlan.newValue) {
        update.arrivalTime = arrPlan.newValue;
      }
    }

    if (Object.keys(update).length === 0) continue;

    try {
      await prisma.flight.update({ where: { id: f.id }, data: update });
    } catch (err) {
      report.errors += 1;
      logger.error({
        operation: 'backfill_update_failed',
        flightId: f.id,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  return report;
}

function printReport(report: BackfillReport, apply: boolean): void {
  const mode = apply ? 'APPLIED' : 'DRY-RUN';

  process.stdout.write(`\n=== Time-semantics backfill (${mode}) ===\n`);
  process.stdout.write(`Total flights with UNKNOWN side: ${report.total}\n\n`);

  process.stdout.write(`By dataSource:\n`);
  for (const [src, n] of Object.entries(report.bySource).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${src.padEnd(28)} ${n}\n`);
  }

  const fmt = (s: SideStats): string =>
    `UTC=${s.utc}  LEGACY_converted=${s.legacyConverted}  ` +
    `LEGACY_skipped=${s.legacySkipped}  stayed_UNKNOWN=${s.unknownLeft}`;

  process.stdout.write(`\nDeparture:  ${fmt(report.dep)}\n`);
  process.stdout.write(`Arrival:    ${fmt(report.arr)}\n`);

  if (report.errors > 0) process.stdout.write(`\nErrors during update: ${report.errors}\n`);
  if (!apply) {
    process.stdout.write(`\n(dry-run — re-run with --apply to write changes)\n`);
  }
  process.stdout.write('\n');
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const report = await run(apply);
  printReport(report, apply);
  await prisma.$disconnect();
  if (report.errors > 0) process.exit(1);
}

main().catch((err) => {
  logger.error({ operation: 'backfill_fatal', error: err instanceof Error ? err.message : 'unknown' });
  process.exit(1);
});
