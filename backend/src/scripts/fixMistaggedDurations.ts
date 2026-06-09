/**
 * Detect and repair flights whose time-semantics tag inflates/deflates the
 * displayed duration.
 *
 * Context: `tzAwareDurationMinutes` re-interprets a `LEGACY_FAKE_UTC` row by
 * converting each endpoint through its airport timezone. That is correct when
 * the stored times are a genuine per-airport local pair, but a number of
 * imported rows store a *consistent* pair whose naïve difference already equals
 * the true elapsed time. For those, the per-side conversion shifts the duration
 * by the inter-airport tz offset (e.g. EK415 SYD→DXB showed 21.3h instead of
 * 14.3h). The fix is to retag those rows to `UTC` so the naïve diff is used.
 *
 * A row is flagged ONLY when the naïve duration is clearly closer to the
 * great-circle minimum flight time than the legacy-converted duration AND the
 * naïve duration is itself physically plausible — so genuinely-corrupt rows
 * (zero / negative naïve duration) are reported for manual review, never
 * silently "fixed".
 *
 * Modes:
 *   tsx src/scripts/fixMistaggedDurations.ts            # dry-run (default)
 *   tsx src/scripts/fixMistaggedDurations.ts --apply    # retag flagged rows → UTC
 */

import { prisma } from '../db';
import { haversineKm } from '../services/co2Calculator';
import { legacyFakeUtcToRealUtc } from '../utils/timezone';
import { getCachedAirport } from '../services/airportCache';
import logger from '../utils/logger';

// Cruise speed assumption for the great-circle baseline + a fixed taxi/climb
// overhead. Deliberately generous: this is a plausibility band, not a precise
// model.
const CRUISE_KMH = 850;
const OVERHEAD_MIN = 30;

// Thresholds (minutes). naïve must beat legacy by this margin against the
// great-circle expectation, the legacy/naïve gap must be meaningful, and naïve
// must land within this slack of the expectation to count as "plausible".
const CLOSER_MARGIN_MIN = 45;
const MEANINGFUL_GAP_MIN = 60;
const PLAUSIBLE_SLACK_MIN = 180;

interface Candidate {
  id: string;
  flightNumber: string | null;
  route: string;
  naiveMin: number;
  legacyMin: number;
  expMin: number;
}

interface Report {
  scanned: number;
  flagged: Candidate[];
  needsManualReview: Candidate[];
  skippedNoTz: number;
}

function expectedMinutes(gcKm: number): number {
  return (gcKm / CRUISE_KMH) * 60 + OVERHEAD_MIN;
}

async function run(apply: boolean): Promise<Report> {
  const flights = await prisma.flight.findMany({
    where: {
      depTimeSemantics: 'LEGACY_FAKE_UTC',
      arrTimeSemantics: 'LEGACY_FAKE_UTC',
    },
    select: {
      id: true,
      flightNumber: true,
      depIata: true,
      arrIata: true,
      departureTime: true,
      arrivalTime: true,
      depLat: true,
      depLon: true,
      arrLat: true,
      arrLon: true,
    },
  });

  const report: Report = { scanned: 0, flagged: [], needsManualReview: [], skippedNoTz: 0 };

  for (const f of flights) {
    if (!f.departureTime || !f.arrivalTime) continue;
    const [depAirport, arrAirport] = await Promise.all([
      getCachedAirport(f.depIata ?? ''),
      getCachedAirport(f.arrIata ?? ''),
    ]);
    const depTz = depAirport?.timezone ?? null;
    const arrTz = arrAirport?.timezone ?? null;
    if (!depTz || !arrTz) {
      report.skippedNoTz += 1;
      continue;
    }
    report.scanned += 1;

    const naiveMin = (f.arrivalTime.getTime() - f.departureTime.getTime()) / 60_000;
    const legacyMin =
      (legacyFakeUtcToRealUtc(f.arrivalTime, arrTz).getTime() -
        legacyFakeUtcToRealUtc(f.departureTime, depTz).getTime()) /
      60_000;
    const gcKm = haversineKm(f.depLat, f.depLon, f.arrLat, f.arrLon);
    const expMin = expectedMinutes(gcKm);

    const naiveCloser =
      Math.abs(naiveMin - expMin) + CLOSER_MARGIN_MIN < Math.abs(legacyMin - expMin);
    const meaningfulGap = Math.abs(legacyMin - naiveMin) > MEANINGFUL_GAP_MIN;
    if (!naiveCloser || !meaningfulGap) continue;

    const candidate: Candidate = {
      id: f.id,
      flightNumber: f.flightNumber,
      route: `${f.depIata ?? '?'}-${f.arrIata ?? '?'}`,
      naiveMin: Math.round(naiveMin),
      legacyMin: Math.round(legacyMin),
      expMin: Math.round(expMin),
    };

    const naivePlausible = naiveMin > 0 && Math.abs(naiveMin - expMin) <= PLAUSIBLE_SLACK_MIN;
    if (!naivePlausible) {
      report.needsManualReview.push(candidate);
      continue;
    }

    report.flagged.push(candidate);

    if (apply) {
      try {
        await prisma.flight.update({
          where: { id: f.id },
          data: { depTimeSemantics: 'UTC', arrTimeSemantics: 'UTC' },
        });
      } catch (err) {
        logger.error({
          operation: 'fix_mistagged_duration_failed',
          flightId: f.id,
          error: err instanceof Error ? err.message : 'unknown',
        });
      }
    }
  }

  return report;
}

function printReport(report: Report, apply: boolean): void {
  const mode = apply ? 'APPLIED' : 'DRY-RUN';
  const h = (m: number): string => (m / 60).toFixed(1);

  process.stdout.write(`\n=== Mis-tagged duration repair (${mode}) ===\n`);
  process.stdout.write(`Scanned (both-LEGACY, tz known): ${report.scanned}\n`);
  process.stdout.write(`Flagged for retag → UTC:          ${report.flagged.length}\n`);
  process.stdout.write(`Needs manual review (corrupt):    ${report.needsManualReview.length}\n`);
  process.stdout.write(`Skipped (missing airport tz):     ${report.skippedNoTz}\n\n`);

  for (const c of report.flagged) {
    process.stdout.write(
      `  RETAG  ${(c.flightNumber ?? '——').padEnd(8)} ${c.route.padEnd(9)} ` +
        `naive=${h(c.naiveMin)}h legacy=${h(c.legacyMin)}h exp=${h(c.expMin)}h\n`,
    );
  }
  for (const c of report.needsManualReview) {
    process.stdout.write(
      `  REVIEW ${(c.flightNumber ?? '——').padEnd(8)} ${c.route.padEnd(9)} ` +
        `naive=${h(c.naiveMin)}h (implausible — corrupt source times)\n`,
    );
  }
  if (!apply) process.stdout.write(`\n(dry-run — re-run with --apply to retag)\n`);
  process.stdout.write('\n');
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const report = await run(apply);
  printReport(report, apply);
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({
    operation: 'fix_mistagged_duration_fatal',
    error: err instanceof Error ? err.message : 'unknown',
  });
  process.exit(1);
});
