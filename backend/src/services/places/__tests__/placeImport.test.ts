import { prisma } from "../../../db";
import { previewPlaceImport } from "../placeImportPreview";
import { commitPlaceImport } from "../placeImportCommit";
import type { PlaceImportCandidate } from "../../../schemas/placeImport";

/**
 * POI Phase D §5.
 *
 * The decision this pins: a row the machine cannot finish is an OFFER, not a
 * silent drop and not a silent create. The lodging import already says that in
 * its own commit — "each of those deserves one decision, not an entry" — and a
 * Google Takeout row is the case that makes it matter here, because it carries a
 * name, the user's own note, and no coordinates at all.
 */
const row = (i: number, over: Partial<PlaceImportCandidate> = {}): PlaceImportCandidate => ({
  sourceRowIndex: i,
  name: `Place ${i}`,
  lat: 41.8902,
  lon: 12.4922,
  ...over,
});

describe("POI import: preview decides, commit writes", () => {
  let userId: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { username: `poi-import-${Date.now()}-${Math.random()}`, passwordHash: "x" },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.importBatch.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  describe("preview", () => {
    it("offers a row with no coordinates instead of discarding it", async () => {
      const { rows, summary } = await previewPlaceImport(userId, [
        row(0, { lat: null, lon: null, notes: "best carbonara" }),
      ]);

      expect(rows[0].action).toBe("needs_input");
      expect(rows[0].flags).toContain("missing_coordinates");
      // The user's own note survives to the offer. Dropping the row would throw
      // away the one thing only they could have written.
      expect(rows[0].notes).toBe("best carbonara");
      expect(summary.needsInput).toBe(1);
      expect(summary.newRows).toBe(0);
    });

    it("skips a row it already holds under the same identity", async () => {
      await prisma.place.create({
        data: { userId, name: "Colosseo", lat: 41.8902, lon: 12.4922, externalRef: "gmaps:123" },
      });

      const { rows, summary } = await previewPlaceImport(userId, [
        row(0, { name: "Colosseo", externalRef: "gmaps:123" }),
      ]);

      expect(rows[0].action).toBe("skip");
      expect(rows[0].dedupeHint).toBe("place_exact_ref");
      // This is what makes running the same file twice a no-op.
      expect(summary.alreadyPresent).toBe(1);
    });

    it("asks about a same-name place at the same spot rather than deciding", async () => {
      // The likeliest cause is the user adding it by hand before importing.
      // Only they can say whether it is the same place — unlike the identity
      // match above, which is certain.
      await prisma.place.create({
        data: { userId, name: "Colosseo", lat: 41.8902, lon: 12.4922 },
      });

      const { rows } = await previewPlaceImport(userId, [row(0, { name: "Colosseo" })]);

      expect(rows[0].action).toBe("needs_input");
      expect(rows[0].dedupeHint).toBe("place_nearby");
      expect(rows[0].matchedPlaceId).not.toBeNull();
    });

    it("does not see another user's places", async () => {
      const other = await prisma.user.create({
        data: { username: `poi-other-${Date.now()}-${Math.random()}`, passwordHash: "x" },
      });
      await prisma.place.create({
        data: {
          userId: other.id,
          name: "Colosseo",
          lat: 41.8902,
          lon: 12.4922,
          externalRef: "gmaps:123",
        },
      });

      const { rows } = await previewPlaceImport(userId, [row(0, { externalRef: "gmaps:123" })]);
      expect(rows[0].action).toBe("create");

      await prisma.place.deleteMany({ where: { userId: other.id } });
      await prisma.user.deleteMany({ where: { id: other.id } });
    });
  });

  describe("commit", () => {
    it("writes the placed rows and reports the unplaced ones by row", async () => {
      const result = await commitPlaceImport(userId, "csv", "saved.csv", [
        row(0, { name: "Colosseo" }),
        row(1, { name: "Trattoria da Enzo", lat: null, lon: null }),
      ]);

      expect(result.created).toBe(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].sourceRowIndex).toBe(1);
      expect(result.failed[0].code).toBe("no_position");
      // A `Place` is still always a point — the invariant is kept here, not by
      // refusing the row at the schema.
      expect(await prisma.place.count({ where: { userId } })).toBe(1);
    });

    it("treats a repeat of the same file as a skip, not a failure", async () => {
      const rows = [row(0, { name: "Colosseo", externalRef: "gmaps:123" })];
      await commitPlaceImport(userId, "csv", "saved.csv", rows);
      const second = await commitPlaceImport(userId, "csv", "saved.csv", rows);

      expect(second.created).toBe(0);
      expect(second.skipped).toBe(1);
      expect(second.failed).toEqual([]);
      expect(await prisma.place.count({ where: { userId } })).toBe(1);
    });

    it("does not lose the whole file to one bad row", async () => {
      const result = await commitPlaceImport(userId, "csv", "saved.csv", [
        row(0, { name: "Colosseo" }),
        row(1, { name: "Nowhere", lat: null, lon: null }),
        row(2, { name: "Pantheon", lat: 41.8986, lon: 12.4769 }),
      ]);

      expect(result.created).toBe(2);
      expect(result.failed).toHaveLength(1);
    });

    it("never puts a raw database message in the response", async () => {
      // The body is a 201, so the error handler's leak protections never run on
      // it — the vocabulary has to be fixed at the source.
      const result = await commitPlaceImport(userId, "csv", null, [
        row(0, { lat: null, lon: null }),
      ]);

      expect(result.failed[0].error).toBe("The row has no coordinates, so it was not imported.");
    });

    it("marks a row with a visit date as visited, and one without as saved", async () => {
      await commitPlaceImport(userId, "csv", null, [
        row(0, { name: "Been there", visitedAt: "2024-04-12" }),
        row(1, { name: "Saved for later", lat: 41.9, lon: 12.5 }),
      ]);

      const been = await prisma.place.findFirst({ where: { userId, name: "Been there" } });
      const saved = await prisma.place.findFirst({ where: { userId, name: "Saved for later" } });
      expect(been?.visited).toBe(true);
      expect(saved?.visited).toBe(false);
    });

    it("leaves the category default alone when the file names none", async () => {
      await commitPlaceImport(userId, "csv", null, [row(0, { category: null })]);
      const place = await prisma.place.findFirst({ where: { userId } });
      expect(place?.category).toBe("other");
    });
  });
});
