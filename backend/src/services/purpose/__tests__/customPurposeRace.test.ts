import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";

import { prisma } from "../../../db";
import { deleteCustomPurpose, updateCustomPurpose } from "../customPurposes";
import { inheritPurposeOnCreate } from "../tripInheritance";

/**
 * Codex review, rc.47: a write outside a transaction read a custom purpose without holding it, so
 * a delete or re-kind running in between left a dangling key or the old kind. And an entry
 * created in a trip with an explicit purposeKey had it overwritten by the trip's category.
 */
describe("custom purpose: a write racing a delete or re-kind converges", () => {
  const stamp = Date.now();
  let userId: string;
  let customId: string;

  const flight = (extra: Record<string, unknown> = {}) =>
    prisma.flight.create({
      data: {
        userId,
        depIata: "FRA",
        arrIata: "FCO",
        depLat: 50,
        depLon: 8,
        arrLat: 41,
        arrLon: 12,
        status: "flown",
        departureTime: new Date("2025-03-01T08:00:00Z"),
        arrivalTime: new Date("2025-03-01T10:00:00Z"),
        ...extra,
      },
    });

  /** Runs `change` inside a transaction holding the purpose FOR UPDATE until `release` is called. */
  function hold(change: (tx: typeof prisma) => Promise<void>) {
    let release: () => void = () => {};
    let locked: () => void = () => {};
    const isLocked = new Promise<void>((r) => (locked = r));
    const gate = new Promise<void>((r) => (release = r));
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM custom_purposes WHERE id = ${customId} FOR UPDATE`;
        await change(tx as unknown as typeof prisma);
        locked();
        await gate;
      },
      { timeout: 20_000 }
    );
    return { isLocked, release, done };
  }

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { username: `pkr-${stamp}`, passwordHash: "x" } }))
      .id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });
  beforeEach(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.customPurpose.deleteMany({ where: { userId } });
    customId = (
      await prisma.customPurpose.create({
        data: { userId, name: "Messe", kind: "business", color: "#000000", icon: "star" },
      })
    ).id;
  });

  it("a re-kind committed while the write was in flight reaches the new entry", async () => {
    const h = hold(async (tx) => {
      await tx.customPurpose.update({ where: { id: customId }, data: { kind: "private" } });
    });
    await h.isLocked;
    // The write reads the committed (old) kind; its settling check waits for the re-kind.
    const writing = flight({ purpose: `custom:${customId}` });
    setTimeout(h.release, 200);
    const f = await writing;
    await h.done;
    const stored = await prisma.flight.findUniqueOrThrow({ where: { id: f.id } });
    expect(stored).toMatchObject({ purpose: "private", purposeKey: `custom:${customId}` });
  });

  it("a delete committed while the write was in flight leaves no dangling key", async () => {
    const h = hold(async (tx) => {
      await tx.customPurpose.delete({ where: { id: customId } });
    });
    await h.isLocked;
    const writing = flight({ purposeKey: `custom:${customId}` });
    setTimeout(h.release, 200);
    const f = await writing.catch(() => null);
    await h.done;
    if (f) {
      const stored = await prisma.flight.findUniqueOrThrow({ where: { id: f.id } });
      expect(stored.purposeKey).toBeNull();
      expect(stored.purpose).toBe("business");
    }
  });

  it("a delete after the write sees the entry and refuses; a re-kind after it carries it along", async () => {
    await flight({ purpose: `custom:${customId}` });
    expect(await deleteCustomPurpose(userId, customId)).toBe("in-use");
    await updateCustomPurpose(userId, customId, { kind: "private" });
    expect((await prisma.flight.findFirstOrThrow({ where: { userId } })).purpose).toBe("private");
  });
});

describe("trip inheritance keeps an explicit purposeKey", () => {
  it("an entry created in a business trip with only a purposeKey keeps that key", async () => {
    const out = await inheritPurposeOnCreate(
      "Flight",
      "create",
      { data: { tripId: "t1", purposeKey: "builtin:vacation" } },
      async () => "business"
    );
    expect(out).toEqual({ data: { tripId: "t1", purposeKey: "builtin:vacation" } });
  });

  it("without any purpose it still inherits the trip's", async () => {
    const out = (await inheritPurposeOnCreate(
      "Flight",
      "create",
      { data: { tripId: "t1" } },
      async () => "business"
    )) as { data: Record<string, unknown> };
    expect(out.data.purpose).toBe("business");
  });
});
