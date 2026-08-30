/**
 * Seeds the catalogue tables the backend integration tests assume are populated:
 * airlines, aircraft, ships, ports, achievements and airports (incl. the
 * timezone backfill the CSV seed leaves NULL — prod fills it lazily, the
 * importPreview tests do not).
 *
 * Local test-harness tooling only. NEVER run against a production database.
 */
import { prisma } from "../src/db";
import { seedAirlinesFromData } from "../src/seedAirlinesFromData";
import { seedAircraftFromData } from "../src/seedAircraftFromData";
import { seedShipsFromCSV } from "../src/seedShipsFromCSV";
import { seedPortsFromCSV } from "../src/seedPortsFromCSV";
import { seedLodgingChainsFromCSV } from "../src/seedLodgingChainsFromCSV";
import { seedAirportsFromCSV } from "../src/seedAirportsFromCSV";
import { ensureAchievements } from "../src/data/achievements";

async function backfillAirportTimezones(): Promise<number> {
  const { find } = await import("geo-tz");
  const airports = await prisma.airport.findMany({
    where: { timezone: null },
    select: { id: true, lat: true, lon: true },
  });

  let updated = 0;
  for (const a of airports) {
    const [zone] = find(a.lat, a.lon);
    if (!zone) continue;
    await prisma.airport.update({ where: { id: a.id }, data: { timezone: zone } });
    updated += 1;
  }
  return updated;
}

async function main(): Promise<void> {
  console.log("airlines:", await seedAirlinesFromData());
  console.log("aircraft:", await seedAircraftFromData());
  console.log("ships:", await seedShipsFromCSV());
  console.log("ports:", await seedPortsFromCSV());
  // Hotel chains are a catalogue table like the four above, and were simply
  // missed here — the only caller was the SERVER's own startup. So a database
  // prepared by this script alone had no chains at all, and
  // `lodgingImportCommit.test.ts` failed on a null `chainId`: the import path
  // resolves an existing chain and refuses to create one unless the caller
  // says so. It passed on developer machines only because a server had run
  // there at some point and left the rows behind. Found by a clean-room CI
  // run, which is the only place that difference is visible.
  console.log("lodging chains:", await seedLodgingChainsFromCSV());
  await ensureAchievements();
  console.log("achievements: ok");
  await seedAirportsFromCSV();
  console.log("airports: ok");
  console.log("timezones backfilled:", await backfillAirportTimezones());
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
