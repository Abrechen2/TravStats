import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { findMicroTripCandidates, mergeTrips } from "../tripCleanupService";

/**
 * A packing list is one per trip and cascades with it (Companion audit
 * 2026-10-23): a merge folds the sources' items into the target's, and a trip
 * that holds nothing but a packing list is not offered for cleanup.
 */
describe("packing lists and trip cleanup", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "mergepacking" } });
    const u = await prisma.user.create({
      data: { username: "mergepacking", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "mergepacking" } });
    await prisma.$disconnect();
  });

  const list = (
    tripId: string,
    items: Array<{ id: string; label: string; done: boolean }>,
    rev = 1
  ) => prisma.tripPackingList.create({ data: { userId, tripId, items, rev } });

  it("folds the source lists into the target's and drops nothing", async () => {
    const target = await prisma.trip.create({ data: { userId, name: "Ziel" } });
    const source = await prisma.trip.create({ data: { userId, name: "Quelle" } });
    await list(target.id, [{ id: "a", label: "Pass", done: true }], 3);
    await list(source.id, [
      { id: "a", label: "Adapter", done: false },
      { id: "b", label: "pass", done: false },
    ]);

    await mergeTrips(userId, { tripIds: [target.id, source.id], targetId: target.id });

    const merged = await prisma.tripPackingList.findUniqueOrThrow({ where: { tripId: target.id } });
    const items = merged.items as Array<{ id: string; label: string; done: boolean }>;
    expect(items.map((i) => [i.label, i.done])).toEqual([
      ["Pass", true],
      ["Adapter", false],
      ["pass", false],
    ]);
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
    expect(merged.rev).toBe(4);
    expect(await prisma.tripPackingList.count({ where: { userId } })).toBe(1);
  });

  it("keeps a made-unique id within the 64 characters an item id may have", async () => {
    const target = await prisma.trip.create({ data: { userId, name: "Ziel" } });
    const source = await prisma.trip.create({ data: { userId, name: "Quelle" } });
    const long = "x".repeat(64);
    await list(target.id, [{ id: long, label: "Pass", done: false }]);
    await list(source.id, [{ id: long, label: "Adapter", done: false }]);

    await mergeTrips(userId, { tripIds: [target.id, source.id], targetId: target.id });

    const merged = await prisma.tripPackingList.findUniqueOrThrow({ where: { tripId: target.id } });
    const ids = (merged.items as Array<{ id: string }>).map((i) => i.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id.length <= 64)).toBe(true);
  });

  // Two ids sharing their first 55 characters used to get the same
  // replacement, and the merged list could no longer be saved (Codex, 2026-10-24).
  it("gives every colliding id its own replacement, however alike they start", async () => {
    const target = await prisma.trip.create({ data: { userId, name: "Ziel" } });
    const source = await prisma.trip.create({ data: { userId, name: "Quelle" } });
    const a = `${"y".repeat(60)}aaaa`;
    const b = `${"y".repeat(60)}bbbb`;
    await list(target.id, [
      { id: a, label: "Pass", done: false },
      { id: b, label: "Visum", done: false },
    ]);
    await list(source.id, [
      { id: a, label: "Adapter", done: false },
      { id: b, label: "Socken", done: false },
    ]);

    await mergeTrips(userId, { tripIds: [target.id, source.id], targetId: target.id });

    const merged = await prisma.tripPackingList.findUniqueOrThrow({ where: { tripId: target.id } });
    const ids = (merged.items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((id) => id.length <= 64)).toBe(true);
  });

  it("moves a source list onto a target that has none", async () => {
    const target = await prisma.trip.create({ data: { userId, name: "Ziel" } });
    const source = await prisma.trip.create({ data: { userId, name: "Quelle" } });
    await list(source.id, [{ id: "x", label: "Socken", done: false }]);

    await mergeTrips(userId, { tripIds: [target.id, source.id], targetId: target.id });

    const merged = await prisma.tripPackingList.findUniqueOrThrow({ where: { tripId: target.id } });
    expect(merged.items).toEqual([{ id: "x", label: "Socken", done: false }]);
  });

  it("does not offer a trip holding only a packing list for cleanup", async () => {
    const bare = await prisma.trip.create({ data: { userId, name: "Leer" } });
    const packed = await prisma.trip.create({ data: { userId, name: "Gepackt" } });
    await list(packed.id, [{ id: "a", label: "Pass", done: false }]);

    const ids = (await findMicroTripCandidates(userId)).map((t) => t.id);
    expect(ids).toContain(bare.id);
    expect(ids).not.toContain(packed.id);
  });
});
