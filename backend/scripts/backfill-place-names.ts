/**
 * One-time, idempotent repair of stored places for the two-name format
 * (forgejo#199). See `src/services/places/placeNameBackfill.ts` for the rule
 * and `src/services/places/visitTripBackfill.ts` for the trip pass.
 *
 * DRY RUN BY DEFAULT — prints what it WOULD change and writes nothing.
 *
 * Usage
 * -----
 *   cd backend
 *   DATABASE_URL=… npx tsx scripts/backfill-place-names.ts            # names, dry run
 *   DATABASE_URL=… npx tsx scripts/backfill-place-names.ts --apply    # names, write
 *   DATABASE_URL=… npx tsx scripts/backfill-place-names.ts --fill-local            # second names, dry run
 *   DATABASE_URL=… npx tsx scripts/backfill-place-names.ts --fill-local --apply    # second names, write
 *   DATABASE_URL=… npx tsx scripts/backfill-place-names.ts --assign-trips          # trips, dry run
 *   DATABASE_URL=… npx tsx scripts/backfill-place-names.ts --assign-trips --apply  # trips, write
 *
 *   --user=<uuid>   only this user's places / visits
 *   --limit=<n>     network lookups per run (default 100; the glued-name splits
 *                   need no network and are never capped)
 *
 * The names pass talks to the instance's configured Photon, one request per
 * 1.1 s at most. The trips pass makes no network request. `--assign-trips`
 * runs ONLY the trips pass, so a names `--apply` can never write trips by
 * accident: their proposals are for the owner to read first.
 *
 * Output goes to stdout for the operator (it names places, so it is for a
 * terminal, not a log); the service's own log lines carry counts only.
 */

import { prisma } from "../src/db";
import {
  backfillPlaceNames,
  DEFAULT_LOOKUP_CAP,
  type NameBackfillReport,
} from "../src/services/places/placeNameBackfill";
import { throttledPhotonGeocoder } from "../src/services/places/photonNameGeocoder";
import { assignVisitTrips, type VisitTripReport } from "../src/services/places/visitTripBackfill";
import { fillLocalNames, type LocalNameFillReport } from "../src/services/places/localNameFill";

interface Args {
  apply: boolean;
  assignTrips: boolean;
  fillLocal: boolean;
  userId?: string;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const value = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const limit = Number(value("limit"));
  return {
    apply: argv.includes("--apply"),
    assignTrips: argv.includes("--assign-trips"),
    fillLocal: argv.includes("--fill-local"),
    userId: value("user"),
    limit: Number.isInteger(limit) && limit >= 0 ? limit : DEFAULT_LOOKUP_CAP,
  };
}

const verb = (apply: boolean) => (apply ? "CHANGED" : "WOULD CHANGE");

function printNames(r: NameBackfillReport): void {
  console.log(`Place names — ${r.apply ? "APPLY" : "DRY RUN (nothing written)"}`);
  console.log(`  candidates: ${r.scanned}, network lookups: ${r.lookups}`);
  for (const c of r.changes) {
    console.log(`  ${verb(r.apply)} [${c.kind}] place ${c.placeId} (user ${c.userId})`);
    console.log(
      `      name:      ${JSON.stringify(c.before.name)} -> ${JSON.stringify(c.after.name)}`
    );
    console.log(`      localName: null -> ${JSON.stringify(c.after.localName)}`);
    if (c.after.externalRef !== c.before.externalRef) {
      console.log(`      externalRef: ${c.before.externalRef} -> ${c.after.externalRef}`);
    } else if (c.refCollision) {
      console.log(`      externalRef: kept — the matched OSM ref belongs to another place`);
    }
  }
  for (const a of r.abstentions) {
    console.log(
      `  LEFT AS IS [${a.reason}] place ${a.placeId} (user ${a.userId}) ${JSON.stringify(a.name)}`
    );
  }
  const split = r.changes.filter((c) => c.kind === "split").length;
  console.log(
    `  summary: ${split} split, ${r.changes.length - split} Latin name found, ` +
      `${r.abstentions.length} left as is`
  );
}

function printTrips(r: VisitTripReport): void {
  console.log(`Visit trips — ${r.apply ? "APPLY" : "DRY RUN (nothing written)"}`);
  console.log(`  visits without a trip: ${r.scanned}`);
  for (const p of r.proposals) {
    console.log(
      `  ${r.apply ? "ASSIGNED" : "WOULD ASSIGN"} visit ${p.visitId} (user ${p.userId}) ` +
        `${JSON.stringify(p.placeName)} on ${p.day} -> trip ${JSON.stringify(p.tripName)} (${p.tripId})`
    );
  }
  console.log(
    `  summary: ${r.proposals.length} to one trip, ${r.noTrip} on no trip's days, ` +
      `${r.severalTrips} on several trips' days, ${r.undated} without a known local day`
  );
}

function printFill(r: LocalNameFillReport): void {
  console.log(`Local names — ${r.apply ? "APPLY" : "DRY RUN (nothing written)"}`);
  console.log(`  candidates: ${r.scanned}, network lookups: ${r.lookups}`);
  for (const f of r.fills) {
    const ref = f.after.externalRef !== f.before.externalRef ? ` | ref ${f.after.externalRef}` : "";
    console.log(
      `  ${r.apply ? "FILLED" : "WOULD FILL"} ${JSON.stringify(f.name)} + ${JSON.stringify(f.localName)}${ref}`
    );
  }
  for (const a of r.abstentions)
    console.log(`  LEFT AS IS [${a.reason}] ${JSON.stringify(a.name)}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.fillLocal) {
    printFill(
      await fillLocalNames({
        geocoder: throttledPhotonGeocoder(),
        apply: args.apply,
        userId: args.userId,
        lookupCap: args.limit,
      })
    );
    return;
  }
  if (args.assignTrips) {
    printTrips(await assignVisitTrips({ apply: args.apply, userId: args.userId }));
    return;
  }
  printNames(
    await backfillPlaceNames({
      geocoder: throttledPhotonGeocoder(),
      apply: args.apply,
      userId: args.userId,
      lookupCap: args.limit,
    })
  );
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
