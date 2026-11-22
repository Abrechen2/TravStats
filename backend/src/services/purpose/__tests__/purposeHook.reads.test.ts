import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";

import { prisma } from "../../../db";
import { runWithHiddenPurposes } from "../../provenance/recordedOnly";

/**
 * The purpose hook in `db.ts` beyond the plain Place read (Codex review of purpose2):
 * a batch transaction never reads outside itself, a Place reached through an include is
 * demoted like a listed one, and "Nur belegte" also governs which visits keep a place visited.
 */
describe("purpose hook: batches, included places and recorded-only", () => {
  const stamp = Date.now();
  let userId: string;
  let tripId: string;
  let hallId: string;
  let listId: string;
  let memoryId: string;
  // A Prisma query is lazy: it must be awaited INSIDE the scope, or it runs after the scope closed.
  const hidden = <T>(fn: () => PromiseLike<T>, recorded = false): Promise<T> =>
    runWithHiddenPurposes({ PlaceVisit: ["business"] }, async () => await fn(), recorded);
  const past = (d: string) => new Date(`${d}T09:00:00Z`);
  const future = () => new Date(Date.now() + 90 * 86_400_000);

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: `purpose-hook-${stamp}`, passwordHash: "x" },
      })
    ).id;
    tripId = (await prisma.trip.create({ data: { userId, name: "Messe", category: "business" } }))
      .id;
    // Visited only through a business visit; what is left visible is a plan.
    hallId = (
      await prisma.place.create({
        data: {
          userId,
          name: "Messehalle",
          lat: 50.1,
          lon: 8.6,
          visited: true,
          visits: {
            create: [
              { userId, visitedAt: past("2025-03-02"), purpose: "business" },
              { userId, visitedAt: future(), purpose: "private" },
            ],
          },
        },
      })
    ).id;
    // Visited through a business visit and a REMEMBERED private one, plus a recorded plan.
    memoryId = (
      await prisma.place.create({
        data: {
          userId,
          name: "Erinnerungscafe",
          lat: 50.3,
          lon: 8.8,
          visited: true,
          visits: {
            create: [
              { userId, visitedAt: past("2025-03-05"), purpose: "business" },
              {
                userId,
                visitedAt: past("2019-07-01"),
                purpose: "private",
                provenance: "remembered",
              },
              { userId, visitedAt: future(), purpose: "private" },
            ],
          },
        },
      })
    ).id;
    listId = (
      await prisma.placeList.create({
        data: { userId, name: "Messen", entries: { create: [{ placeId: hallId }] } },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("a batch transaction that creates the trip itself leaves its entries' purpose unknown, without failing", async () => {
    const newTripId = "00000000-0000-4000-8000-0000000b47c4";
    const [, visit] = await prisma.$transaction([
      prisma.trip.create({
        data: { id: newTripId, userId, name: "Batch", category: "business" },
      }),
      prisma.placeVisit.create({
        data: { userId, placeId: hallId, tripId: newTripId, visitedAt: past("2025-04-01") },
      }),
    ]);
    // Resolved before the batch opened, when the trip did not exist: unknown, never a guess.
    expect(visit.purpose).toBeNull();
    // A committed trip is inherited, in a batch too (purpose.txInheritance.test.ts).
    const [inherited] = await prisma.$transaction([
      prisma.placeVisit.create({
        data: { userId, placeId: hallId, tripId, visitedAt: future() },
      }),
    ]);
    expect(inherited.purpose).toBe("business");
    await prisma.placeVisit.deleteMany({ where: { id: { in: [visit.id, inherited.id] } } });
  });

  it("demotes a place reached through a list entry's include, as the places list does", async () => {
    const entries = await hidden(() =>
      prisma.placeListEntry.findMany({ where: { listId }, include: { place: true } })
    );
    expect(entries.map((e) => e.place.visited)).toEqual([false]);
    const selected = await hidden(() =>
      prisma.placeList.findFirst({
        where: { id: listId },
        select: { entries: { select: { place: { select: { name: true, visited: true } } } } },
      })
    );
    // `id` was only added to match the rows; it does not leak into the answer.
    expect(selected?.entries.map((e) => e.place)).toEqual([{ name: "Messehalle", visited: false }]);
  });

  it("a remembered visit hidden by 'Nur belegte' does not keep a place visited", async () => {
    const hiddenOnly = await hidden(() =>
      prisma.place.findFirst({ where: { id: memoryId }, select: { visited: true } })
    );
    // Without "Nur belegte" the remembered private visit is a visible visit that happened.
    expect(hiddenOnly?.visited).toBe(true);
    const recorded = await hidden(
      () => prisma.place.findFirst({ where: { id: memoryId }, select: { visited: true } }),
      true
    );
    expect(recorded?.visited).toBe(false);
  });
});
