import { randomUUID } from "crypto";
import { prisma } from "../db";

/**
 * The one-owner CHECK on documents now names bus_journey_id: a document may
 * be filed with a bus ride, and never with a bus ride AND anything else.
 */
describe("migration: bus_journeys", () => {
  it("the one-owner CHECK names bus_journey_id", async () => {
    const rows = await prisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'documents_single_owner_check'`;
    expect(rows[0].def).toContain("bus_journey_id");
    expect(rows[0].def).toContain("rental_booking_id");
  });

  it("refuses a document owned by a bus ride and a flight at once (SQLSTATE 23514)", async () => {
    const username = `migbus-${randomUUID().slice(0, 8)}`;
    const user = await prisma.user.create({
      data: { username, passwordHash: "x" },
    });
    try {
      const flight = await prisma.flight.create({
        data: { userId: user.id, depLat: 52.5, depLon: 13.4, arrLat: 48.1, arrLon: 11.6 },
      });
      const ride = await prisma.busJourney.create({
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
        INSERT INTO documents (id, user_id, stored_name, mimetype, size_bytes, sha256, format, bus_journey_id)
        VALUES (${randomUUID()}, ${user.id}, 'a.pdf', 'application/pdf', 1, 'abc', 'pdf', ${ride.id})`;

      const both = prisma.$executeRaw`
        INSERT INTO documents (id, user_id, stored_name, mimetype, size_bytes, sha256, format, flight_id, bus_journey_id)
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
