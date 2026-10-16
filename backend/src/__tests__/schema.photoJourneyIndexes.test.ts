import { prisma } from "../db";

/**
 * photo_journeys.trip_id carries an ON DELETE CASCADE foreign key (the `visit`
 * finding, forgejo#211) and had no index: deleting a trip made Postgres scan
 * the whole table to find the findings to cascade, once per deleted trip.
 */
describe("photo_journeys indexes", () => {
  it("has an index leading with trip_id, so a trip delete cascades without a table scan", async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'photo_journeys'`;
    expect(rows.some((r) => /\(trip_id[,)]/.test(r.indexdef.replace(/"/g, "")))).toBe(true);
  });
});
