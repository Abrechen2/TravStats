import { prisma } from "../../../db";
import { commitPlaceImport } from "../placeImportCommit";
import type { PlaceImportCandidate } from "../../../schemas/placeImport";

/**
 * AUD-074 and AUD-075: the POI import and the manual create disagreed about
 * the same two facts.
 *
 * The manual route derives an ISO country code and decides `visited` with
 * `classifyVisit`, writing the date as a real `PlaceVisit`. The import stored
 * the country as prose only and reduced the date to a boolean it then threw
 * away — so an imported place was invisible to the country filter, counted
 * toward no country at all, and a row dated 2099 arrived as already visited
 * with zero visits to show for it.
 *
 * Parity is the assertion. Both paths answer the same questions about a place,
 * and a user cannot see which one put the row there.
 */
const row = (i: number, over: Partial<PlaceImportCandidate> = {}): PlaceImportCandidate => ({
  sourceRowIndex: i,
  name: `Parity ${i}`,
  lat: 52.52,
  lon: 13.405,
  ...over,
});

describe("POI import matches what a manual create would have written", () => {
  let userId: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { username: `poi-parity-${Date.now()}-${Math.random()}`, passwordHash: "x" },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.importBatch.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  describe("AUD-075 — the country carries its code", () => {
    it("derives the ISO code from the country name", async () => {
      await commitPlaceImport(userId, "csv", "places.csv", [
        row(0, { country: "Deutschland", city: "Berlin", address: "Unter den Linden 1" }),
      ]);

      const place = await prisma.place.findFirstOrThrow({ where: { userId } });
      expect(place.country).toBe("Deutschland");
      // Without this the place is unreachable through `/places?country=DE` and
      // counts toward no country in the POI statistics.
      expect(place.isoCountryCode).toBe("DE");
    });

    it("leaves the code null when the row names no country", async () => {
      await commitPlaceImport(userId, "csv", "places.csv", [row(0)]);

      const place = await prisma.place.findFirstOrThrow({ where: { userId } });
      expect(place.isoCountryCode).toBeNull();
    });
  });

  describe("AUD-074 — a date is kept as a visit, and the future is not the past", () => {
    it("writes a past date as a real visit", async () => {
      await commitPlaceImport(userId, "csv", "places.csv", [
        row(0, { visitedAt: "2020-01-02T00:00:00.000Z" }),
      ]);

      const place = await prisma.place.findFirstOrThrow({
        where: { userId },
        include: { visits: true },
      });
      expect(place.visited).toBe(true);
      // The date used to be reduced to a boolean and discarded, so the place
      // was "visited" with no visit anywhere to show for it.
      expect(place.visits).toHaveLength(1);
      expect(place.visits[0]!.visitedAt?.toISOString()).toBe("2020-01-02T00:00:00.000Z");
    });

    it("does not mark a place visited because of a date in 2099", async () => {
      await commitPlaceImport(userId, "csv", "places.csv", [
        row(0, { visitedAt: "2099-01-02T00:00:00.000Z" }),
      ]);

      const place = await prisma.place.findFirstOrThrow({
        where: { userId },
        include: { visits: true },
      });
      expect(place.visited).toBe(false);
      // The plan is still recorded — it is a visit that has not happened yet,
      // which is exactly what `classifyVisit` calls `planned`.
      expect(place.visits).toHaveLength(1);
    });

    it("saves a place with no date as saved, not visited", async () => {
      await commitPlaceImport(userId, "csv", "places.csv", [row(0)]);

      const place = await prisma.place.findFirstOrThrow({
        where: { userId },
        include: { visits: true },
      });
      expect(place.visited).toBe(false);
      expect(place.visits).toHaveLength(0);
    });
  });
});
