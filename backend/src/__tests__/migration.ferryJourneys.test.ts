import { randomUUID } from "crypto";
import { prisma } from "../db";

/**
 * The one-owner CHECK on documents now names ferry_journey_id: a document may
 * be filed with a ferry ride, and never with a ferry ride AND anything else.
 */
describe("migration: ferry_journeys", () => {
  it("the one-owner CHECK names ferry_journey_id", async () => {
    const rows = await prisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'documents_single_owner_check'`;
    expect(rows[0].def).toContain("ferry_journey_id");
    expect(rows[0].def).toContain("rental_booking_id");
  });

  it("refuses a document owned by a ferry ride and a flight at once (SQLSTATE 23514)", async () => {
    const username = `migferry-${randomUUID().slice(0, 8)}`;
    const user = await prisma.user.create({
      data: { username, passwordHash: "x" },
    });
    try {
      const flight = await prisma.flight.create({
        data: { userId: user.id, depLat: 52.5, depLon: 13.4, arrLat: 48.1, arrLon: 11.6 },
      });
      const ride = await prisma.ferryJourney.create({
        data: {
          userId: user.id,
          depStationName: "ZOB Berlin",
          depLat: 52.5069,
          depLon: 13.2778,
          arrStationName: "ZOB München",
          arrLat: 48.1423,
          arrLon: 11.5384,
          departureTime: new Date("2026-09-20T00:00:00Z"),
        },
      });

      // One owner is fine — proves the insert itself is well-formed, so the
      // refusal below can only be the CHECK.
      await prisma.$executeRaw`
        INSERT INTO documents (id, user_id, stored_name, mimetype, size_bytes, sha256, format, ferry_journey_id)
        VALUES (${randomUUID()}, ${user.id}, 'a.pdf', 'application/pdf', 1, 'abc', 'pdf', ${ride.id})`;

      const both = prisma.$executeRaw`
        INSERT INTO documents (id, user_id, stored_name, mimetype, size_bytes, sha256, format, flight_id, ferry_journey_id)
        VALUES (${randomUUID()}, ${user.id}, 'b.pdf', 'application/pdf', 1, 'abc', 'pdf', ${flight.id}, ${ride.id})`;
      await expect(both).rejects.toMatchObject({
        message: expect.stringContaining("Code: `23514`"),
      });
      expect(await prisma.document.count({ where: { userId: user.id } })).toBe(1);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
