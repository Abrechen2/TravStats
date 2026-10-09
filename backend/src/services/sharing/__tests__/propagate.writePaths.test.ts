import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * Every write path of the shareable types propagates — or says why not.
 *
 * Propagation is called explicitly (design 2026-10-09, "Propagation"), so a
 * new write path that forgets it would silently stop a shared trip's copies
 * from following. This scan finds every source file that writes a flight,
 * stay, house, cruise (or its calls and legs), rail ride, rental or trip
 * stop, and requires each to either call propagation or stand in EXEMPT
 * below with the reason. Both directions fail: an unlisted writer, and a
 * listed file that no longer writes or now propagates (a stale reason is a
 * wrong reason).
 */

const SRC = join(__dirname, "../../..");
const WRITE =
  /\.(flight|lodgingStay|lodging|cruise|cruiseStop|cruiseLeg|railJourney|rentalBooking|tripStop)\s*\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\(/;
const PROPAGATES = /\b(propagateWrites?|propagateDeletes?|detachTrip|propagateBulk)\(/;

const EXEMPT: Record<string, string> = {
  // Propagation itself: its writes are the copies, guarded against recursion.
  "services/sharing/adapters/flat.ts": "propagation writes (the copies)",
  "services/sharing/adapters/lodgingStay.ts": "propagation writes (the copies)",
  "services/sharing/adapters/cruise.ts": "propagation writes (the copies)",
  "services/sharing/adapters/stop.ts": "propagation writes (the copies)",
  "services/sharing/copyEntries.ts": "S1 share copy; keys and copies, no member change",
  // Private columns only.
  "routes/uploads.ts": "clears a receipt URL — private",
  "services/documents/documentService.ts": "clears a receipt URL — private",
  "services/documents/receipts.ts": "receipt links — private",
  "services/xlsxImport/companionLinks.ts": "companions — private",
  "services/rail/railConnection.ts": "booking link — private",
  "routes/rental/links.ts": "roadtrip link — private (no roadtrip is shared)",
  "services/rental/rentalImport.ts":
    "last-mail mark only; its real updates go through rentalRowWrite.ts, which propagates",
  // Every account's rows alike: each copy is maintained on its own.
  "index.ts": "boot-time aircraft-name normalisation, applied to every account",
  "services/statusSweep.ts": "status sweep, runs over every account's rows",
  "services/flightAutoUpdate.ts": "provider tracking job, per account",
  "services/flightLandedStatus.ts": "provider tracking job, per account",
  "services/finalArrivalLookup.ts": "provider lookup job, per account",
  "services/bulkFlightRefresh.ts": "provider refresh, per account",
  "services/nextApiCheckBackfill.ts": "scheduling column — private",
  "services/lodging/geocodeBackfill.ts": "geocoding job, per account",
  "services/lodging/stayFxBackfill.ts": "FX snapshot — private",
  "services/openData/lodgingEnrichment.ts": "open-data enrichment job, per account",
  "services/timeMigration/flights.ts": "ADR 0002 migration, every account alike",
  "services/timeMigration/cruises.ts": "ADR 0002 migration, every account alike",
  "services/timeMigration/rail.ts": "ADR 0002 migration, every account alike",
  "services/timeMigration/tripStops.ts": "ADR 0002 migration, every account alike",
  "services/timeMigration/dayColumns.ts": "ADR 0002 migration, every account alike",
  "services/timeMigration/reResolve.ts": "ADR 0002 migration, every account alike",
  "services/cruiseDistance/cruiseLegService.ts":
    "legs recomputed inside the cruise writes, which propagate after it",
  // Never on a shared trip.
  "services/tripDetectionService.ts": "files unfiled flights into a trip it just created",
  "services/lodging/createLodging.ts": "a new house has no stay yet",
  // Roadtrip stations and tour points: not shared (S1 copies no roadtrip).
  "routes/trips/tourRoutes.ts": "route membership of stops — not a fact",
  "services/roadtrip/companionStations.ts": "roadtrip stations — not shared",
  "services/roadtrip/replaceStations.ts": "roadtrip stations — not shared",
  "services/tour/replaceTourPoints.ts": "tour points — not shared",
  "services/tour/legRecompute.ts":
    "stop update helper; routes/trips/tripStops.ts propagates around it",
  // The spreadsheet import: propagated once per run (sharing/bulkSync.ts).
  "services/xlsxImport/flights.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/rail.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/cruises.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/lodging.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/prune.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/routeLists.ts": "xlsx run, propagated by importSheets.ts",
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return ["generated", "__tests__", "scripts", "seedDemo"].includes(name) ? [] : sources(path);
    }
    if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name.startsWith("seed")) return [];
    return [path];
  });
}

describe("sharing — every write path of a shareable type propagates", () => {
  const files = sources(SRC).map((path) => ({
    rel: relative(SRC, path).split("\\").join("/"),
    text: readFileSync(path, "utf8"),
  }));
  const writers = files.filter((f) => WRITE.test(f.text));

  it("finds the writers at all", () => {
    expect(writers.length).toBeGreaterThan(30);
  });

  it("each writer propagates or is exempt with a reason", () => {
    const missing = writers
      .filter((f) => !PROPAGATES.test(f.text) && !(f.rel in EXEMPT))
      .map((f) => f.rel);
    expect(missing).toEqual([]);
  });

  it("no exemption is stale", () => {
    const byRel = new Map(files.map((f) => [f.rel, f.text]));
    const stale = Object.keys(EXEMPT).filter((rel) => {
      const text = byRel.get(rel);
      return !text || !WRITE.test(text) || PROPAGATES.test(text);
    });
    expect(stale).toEqual([]);
  });
});
