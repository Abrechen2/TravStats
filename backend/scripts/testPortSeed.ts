/**
 * Spot-check the bulk port seeder against the dev DB. Prints how many were
 * inserted on a fresh table and confirms a second run is a no-op.
 */
import { seedPortsFromCSV } from "../src/seedPortsFromCSV";
import { prisma } from "../src/db";

async function main(): Promise<void> {
  const before = await prisma.port.count();
  console.log(`ports before:           ${before}`);

  const t0 = Date.now();
  const inserted1 = await seedPortsFromCSV();
  console.log(`first run inserted:     ${inserted1}  (${Date.now() - t0}ms)`);

  const after = await prisma.port.count();
  console.log(`ports after first run:  ${after}`);

  const t1 = Date.now();
  const inserted2 = await seedPortsFromCSV();
  console.log(`second run inserted:    ${inserted2}  (${Date.now() - t1}ms)`);

  const final = await prisma.port.count();
  console.log(`ports after second run: ${final}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("FAILED:", err);
  await prisma.$disconnect();
  process.exit(1);
});
