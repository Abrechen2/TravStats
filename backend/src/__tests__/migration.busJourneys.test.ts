import { prisma } from "../db";

/**
 * The one-owner CHECK on documents now names bus_journey_id: a document may
 * be filed with a bus ride, and never with a bus ride AND anything else.
 */
describe("migration: bus_journeys", () => {
  it("refuses a document owned by a bus ride and a flight at once", async () => {
    const rows = await prisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'documents_single_owner_check'`;
    expect(rows[0].def).toContain("bus_journey_id");
    expect(rows[0].def).toContain("rental_booking_id");
  });
});
