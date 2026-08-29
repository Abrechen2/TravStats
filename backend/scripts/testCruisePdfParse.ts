/**
 * One-off: pipe a TUI Mein Schiff sample PDF through the cruise parser pipeline
 * end-to-end (extractTextFromPdf → parseCruiseBookingText → resolveCruiseEntities)
 * against a real Ollama and the dev DB. Prints what would be POSTed to /cruises.
 *
 * Usage:
 *   DATABASE_URL=postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev \
 *   OLLAMA_URL=http://<ollama-host>:11434 \
 *   npx tsx scripts/testCruisePdfParse.ts <path-to-pdf>
 */
import { promises as fs } from "fs";
import path from "path";
import { extractTextFromPdf } from "../src/services/pdfParser";
import { parseCruiseBookingText } from "../src/services/cruiseBookingParser";
import { resolveCruiseEntities } from "../src/services/cruiseEntityResolver";
import { prisma } from "../src/db";

async function main(): Promise<void> {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error("Usage: npx tsx scripts/testCruisePdfParse.ts <path-to-pdf>");
    process.exit(1);
  }

  const abs = path.resolve(pdfPath);
  console.log(`\n=== ${path.basename(abs)} ===`);

  const buffer = await fs.readFile(abs);
  const t0 = Date.now();
  const text = await extractTextFromPdf(buffer);
  console.log(`[1/3] PDF text extracted: ${text.length} chars (${Date.now() - t0}ms)`);

  const t1 = Date.now();
  const parseResult = await parseCruiseBookingText(text);
  console.log(
    `[2/3] LLM parse done: ${parseResult.cruises.length} cruise(s) (${Date.now() - t1}ms)`,
  );

  const t2 = Date.now();
  const resolved = await Promise.all(parseResult.cruises.map(resolveCruiseEntities));
  console.log(`[3/3] Entity resolve done (${Date.now() - t2}ms)\n`);

  for (const [i, entry] of resolved.entries()) {
    console.log(`--- Cruise ${i + 1} ---`);
    console.log(`  shipMatched:        ${entry.shipMatched}`);
    console.log(`  ship:               ${entry.input.shipNameOverride ?? `(id ${entry.input.shipId})`}`);
    console.log(`  cruiseLine:         ${entry.input.cruiseLine ?? "—"}`);
    console.log(`  routeName:          ${entry.input.routeName ?? "—"}`);
    console.log(`  startDate:          ${entry.input.startDate ?? "—"}`);
    console.log(`  endDate:            ${entry.input.endDate ?? "—"}`);
    console.log(`  cabin:              ${[entry.input.cabinNumber, entry.input.cabinType, entry.input.deck && `Deck ${entry.input.deck}`].filter(Boolean).join(" · ") || "—"}`);
    console.log(`  bookingReference:   ${entry.input.bookingReference ?? "—"}`);
    console.log(`  price:              ${entry.input.price ?? "—"} ${entry.input.currency ?? ""}`);
    console.log(`  stops (${entry.input.stops?.length ?? 0}):`);
    for (const s of entry.input.stops ?? []) {
      const tag = s.isAtSea ? "SEA  " : `port=${s.portId ?? "null"}`.padEnd(11);
      const date = (s.date ?? "----------").slice(0, 10);
      const time = [s.arrivalTime, s.departureTime].filter(Boolean).join(" → ");
      const note = s.excursionNote ? `  [${s.excursionNote}]` : "";
      console.log(`    Day ${s.dayNumber.toString().padStart(2)}: ${date}  ${tag} ${time}${note}`);
    }
    if (entry.unmatchedPorts.length > 0) {
      console.log(`  unmatched ports:    ${entry.unmatchedPorts.map((p) => `Day ${p.dayNumber}: ${p.portName}`).join(", ")}`);
    }
    console.log();
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("FAILED:", err);
  await prisma.$disconnect();
  process.exit(1);
});
