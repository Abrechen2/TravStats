/**
 * Auditor I2, data-integrity audit 2026-09-19 — NOT COMMITTED.
 *
 * Does a transaction still roll back under the Prisma 7 pg driver adapter?
 *
 * Prisma 7 is Rust-free: `$transaction` is executed by `@prisma/adapter-pg`
 * against a `pg.Pool` connection rather than by the query engine. A rollback
 * that silently stopped working would be invisible — every route that writes
 * two rows "atomically" would be writing them one at a time, and the first
 * half of a failed write would stay.
 */
import { prisma } from "../../db";

const TAG = `i2tx-${Date.now()}`;
let userId = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { username: `${TAG}-user`, passwordHash: "x" },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("interactive $transaction(async tx => …)", () => {
  it("persists nothing when the callback throws after a write", async () => {
    const before = await prisma.trip.count({ where: { userId } });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.trip.create({ data: { userId, name: `${TAG}-rollback-trip` } });
        // Proof the row exists INSIDE the transaction — otherwise a rollback
        // assertion could pass because the insert never happened at all.
        const inside = await tx.trip.count({ where: { userId } });
        expect(inside).toBe(before + 1);
        throw new Error("deliberate failure after the write");
      })
    ).rejects.toThrow("deliberate failure after the write");

    expect(await prisma.trip.count({ where: { userId } })).toBe(before);
    expect(await prisma.trip.findFirst({ where: { name: `${TAG}-rollback-trip` } })).toBeNull();
  });

  it("rolls back BOTH writes when the second one violates a constraint", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: `${TAG}-two-writes` } });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.tripJournalEntry.create({
          data: { tripId: trip.id, date: new Date(), title: `${TAG}-entry`, body: "kept?" },
        });
        // Proof the first write landed INSIDE the transaction, so the
        // assertion below measures a rollback and not a create that never ran.
        expect(await tx.tripJournalEntry.count({ where: { tripId: trip.id } })).toBe(1);
        // A foreign key that cannot resolve — the DB rejects it.
        await tx.tripJournalEntry.create({
          data: {
            tripId: "00000000-0000-0000-0000-000000000000",
            date: new Date(),
            title: "x",
            body: "y",
          },
        });
      })
    ).rejects.toBeDefined();

    expect(await prisma.tripJournalEntry.count({ where: { tripId: trip.id } })).toBe(0);
  });

  it("does not leak the failed transaction's connection: the client still works", async () => {
    // A pooled connection left in a failed transaction state would make every
    // later query answer `25P02 current transaction is aborted`.
    const n = await prisma.user.count({ where: { id: userId } });
    expect(n).toBe(1);
  });
});

describe("batch $transaction([…])", () => {
  it("persists none of the members when one of them fails", async () => {
    const before = await prisma.trip.count({ where: { userId } });

    await expect(
      prisma.$transaction([
        prisma.trip.create({ data: { userId, name: `${TAG}-batch-a` } }),
        prisma.trip.create({ data: { userId, name: `${TAG}-batch-b` } }),
        // userId is a FK to users(id) — this member cannot commit.
        prisma.trip.create({
          data: { userId: "00000000-0000-0000-0000-000000000000", name: `${TAG}-batch-c` },
        }),
      ])
    ).rejects.toBeDefined();

    expect(await prisma.trip.count({ where: { userId } })).toBe(before);
    expect(await prisma.trip.findFirst({ where: { name: `${TAG}-batch-a` } })).toBeNull();
    expect(await prisma.trip.findFirst({ where: { name: `${TAG}-batch-b` } })).toBeNull();
  });

  it("commits every member when all of them succeed", async () => {
    const [a, b] = await prisma.$transaction([
      prisma.trip.create({ data: { userId, name: `${TAG}-ok-a` } }),
      prisma.trip.create({ data: { userId, name: `${TAG}-ok-b` } }),
    ]);
    expect(await prisma.trip.findUnique({ where: { id: a.id } })).not.toBeNull();
    expect(await prisma.trip.findUnique({ where: { id: b.id } })).not.toBeNull();
  });
});
