/**
 * One-off: fill `Lodging.isoCountryCode` from the free-text `country`.
 *
 * The text column keeps whatever the source wrote — a booking mail in German,
 * a saved-places export in the country's own language, a Google response in
 * English. Measured on one real library: 60 spellings for 33 countries, so the
 * lodging filter listed "Deutschland" and "Germany" as different places.
 *
 * Writes ONLY the new column and never touches `country` itself: the text is
 * what the source said, and rewriting it would destroy the evidence. What is
 * derived goes in the derived column.
 *
 * Idempotent — running it twice changes nothing the second time. Pass
 * `--dry-run` to see the outcome without writing.
 *
 *   npx tsx src/scripts/backfillLodgingCountryCodes.ts [--dry-run]
 */
import { prisma } from "../db";
import { resolveCountryCode } from "../shared/geo/countryCode";
import logger from "../utils/logger";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const lodgings = await prisma.lodging.findMany({
    select: { id: true, name: true, country: true, isoCountryCode: true },
  });

  const byCode = new Map<string, number>();
  const unresolved: { name: string; country: string }[] = [];
  const updates: { id: string; code: string | null }[] = [];

  for (const l of lodgings) {
    const code = resolveCountryCode(l.country);
    if (code) byCode.set(code, (byCode.get(code) ?? 0) + 1);
    else if (l.country) unresolved.push({ name: l.name, country: l.country });
    if (code !== l.isoCountryCode) updates.push({ id: l.id, code });
  }

  console.log(`Häuser gesamt:        ${lodgings.length}`);
  console.log(`davon aufgelöst:      ${lodgings.length - unresolved.length}`);
  console.log(`daraus Länder:        ${byCode.size}`);
  console.log(`zu schreiben:         ${updates.length}`);
  if (unresolved.length > 0) {
    console.log(`\nNICHT aufgelöst (${unresolved.length}) — bitte ansehen, das sind Datenfehler:`);
    for (const u of unresolved) console.log(`  "${u.country}"  <-  ${u.name}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: nichts geschrieben.");
    return;
  }

  // Serial rather than one big transaction: this touches a single nullable
  // column, a partial run is not a broken state, and re-running finishes it.
  let written = 0;
  for (const u of updates) {
    await prisma.lodging.update({ where: { id: u.id }, data: { isoCountryCode: u.code } });
    written++;
  }
  logger.info({ operation: "backfill_lodging_country_codes", written }, "[Backfill] Country codes written");
  console.log(`\ngeschrieben: ${written}`);
}

main()
  .catch((err) => {
    logger.error({ err }, "[Backfill] failed");
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
