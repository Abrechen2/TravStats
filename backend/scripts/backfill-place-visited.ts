/**
 * One-time, idempotent repair: places whose past visit should have marked them
 * visited and did not, because the visit writers read the legacy wall-clock
 * column east of UTC. See `src/services/places/visitedFlagBackfill.ts` for the
 * rule — which places qualify, and why checklist rows, undated visits and
 * plans that merely came due are left alone.
 *
 * DRY RUN BY DEFAULT — prints what it WOULD change and writes nothing.
 *
 * Usage
 * -----
 *   cd backend
 *   DATABASE_URL=… npx tsx scripts/backfill-place-visited.ts                 # dry run, all users
 *   DATABASE_URL=… npx tsx scripts/backfill-place-visited.ts --user=<uuid>   # dry run, one user
 *   DATABASE_URL=… npx tsx scripts/backfill-place-visited.ts --apply         # write
 *
 * Inside the production container (`docker exec … npx tsx scripts/…`) the same
 * flags apply. Output names places, so it is for a terminal, not a log; the
 * service's own log line carries counts only.
 */

import { prisma } from "../src/db";
import { backfillVisitedFlags } from "../src/services/places/visitedFlagBackfill";

function parseArgs(argv: string[]): { apply: boolean; userId?: string } {
  const user = argv.find((a) => a.startsWith("--user="))?.split("=")[1];
  return { apply: argv.includes("--apply"), userId: user || undefined };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await backfillVisitedFlags(args);
  const verb = report.apply ? "PROMOTED" : "WOULD PROMOTE";
  console.log(`Place visited flag — ${report.apply ? "APPLY" : "DRY RUN (nothing written)"}`);
  console.log(`  not-visited places with visits: ${report.scanned}`);
  for (const c of report.candidates) {
    console.log(
      `  ${verb} place ${c.placeId} (user ${c.userId}) ${JSON.stringify(c.placeName)}` +
        ` — visit ${c.visitId} at ${c.visitInstant.toISOString()} via ${c.writtenVia ?? "unknown"}`
    );
  }
  console.log(
    report.apply
      ? `  ${report.promoted} of ${report.candidates.length} place(s) promoted`
      : `  ${report.candidates.length} place(s) would be promoted — re-run with --apply to write`
  );
}

main()
  .catch((error) => {
    console.error("Visited-flag backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
