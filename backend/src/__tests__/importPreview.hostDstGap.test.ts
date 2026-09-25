import { buildPreviewRows } from "../services/importPreview";
import { prisma } from "../db";

/**
 * The corrected arrival time used `formatInTimeZone`, which is an hour late
 * whenever the airport's wall clock falls into the HOST's own DST gap. JFK →
 * LHR landing 01:30Z on 30 March 2025 reads 02:30 BST in London; with the
 * server in Europe/Berlin, 02:30 is exactly Berlin's missing hour, and the
 * preview proposed 03:30.
 */
describe("importPreview arrival wall clock, host in a DST gap", () => {
  const originalTz = process.env.TZ;
  let userId: string;

  beforeAll(async () => {
    process.env.TZ = "Europe/Berlin";
    const user = await prisma.user.create({
      data: { username: "test-import-preview-gap-" + Date.now(), passwordHash: "x" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    process.env.TZ = originalTz;
    await prisma.user.delete({ where: { id: userId } });
  });

  it("proposes the London clock the plane landed at", async () => {
    const { rows } = await buildPreviewRows(userId, [
      {
        date: "2025-03-29",
        depTimeLocal: "20:00:00", // EDT, 00:00Z on the 30th
        durationSeconds: 90 * 60,
        fromIata: "JFK",
        toIata: "LHR",
        flightNumber: "XX1",
        source: "generic_csv",
        sourceRowIndex: 0,
      },
    ]);
    expect(rows[0].arrUtc.toISOString()).toBe("2025-03-30T01:30:00.000Z");
    expect(rows[0].arrivalLocalCorrected).toBe("2025-03-30T02:30:00");
  });
});
