/**
 * Auditor I2, data-integrity audit 2026-09-19 — NOT COMMITTED.
 *
 * `services/lodging/geocodeBackfill.ts:306-331` writes the geocoder's answer
 * with `prisma.lodging.updateMany({ where: { id, lat: null, lon: null }, data: {
 *   lat, lon, …, ...(coords.chainName && row.chainId === null
 *        ? { chain: { connect: { name: coords.chainName } } } : {}) } })`.
 *
 * `updateMany` takes `LodgingUpdateManyMutationInput`, which carries `chainId`
 * and no `chain` relation (src/generated/prisma/models/Lodging.ts:615). The
 * nested `connect` is therefore an unknown argument. TypeScript does not catch
 * it — the excess-property check does not reach a conditionally spread object
 * literal — so this is a RUNTIME failure, and the per-row `catch` above it
 * turns the failure into a log line and moves on.
 *
 * Consequence: for exactly the rows where the geocoder DID identify a chain and
 * the house has none yet, the coordinates are thrown away too. Nothing stored,
 * nothing shown to the user, and the row's `geocodeAttemptedAt` was already
 * stamped, so it goes to the back of the queue and fails the same way next time.
 */
import { prisma } from "../../db";

const TAG = `i2geo-${Date.now()}`;
let userId = "";
let chainId = 0;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { username: `${TAG}-user`, passwordHash: "x" },
  });
  userId = user.id;
  const chain = await prisma.lodgingChain.create({
    data: { name: `${TAG}-Chain`, isUserAdded: true },
  });
  chainId = chain.id;
});

afterAll(async () => {
  await prisma.lodging.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { username: { startsWith: TAG } } });
  await prisma.lodgingChain.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("the geocode backfill's position write", () => {
  it("stores the position when the geocoder named NO chain (the control)", async () => {
    const row = await prisma.lodging.create({
      data: { userId, name: `${TAG}-no-chain`, type: "hotel" },
    });

    const written = await prisma.lodging.updateMany({
      where: { id: row.id, lat: null, lon: null },
      data: { lat: 48.1, lon: 11.6, city: "München" },
    });

    expect(written.count).toBe(1);
    const after = await prisma.lodging.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.lat).toBeCloseTo(48.1);
  });

  it("THROWS — and stores no position at all — when the geocoder named a chain", async () => {
    const row = await prisma.lodging.create({
      data: { userId, name: `${TAG}-with-chain`, type: "hotel" },
    });

    // Byte-for-byte the shape geocodeBackfill.ts builds on that branch.
    const write = prisma.lodging.updateMany({
      where: { id: row.id, lat: null, lon: null },
      data: {
        lat: 48.1,
        lon: 11.6,
        city: "München",
        ...({ chain: { connect: { name: `${TAG}-Chain` } } } as unknown as object),
      },
    });

    await expect(write).rejects.toThrow(/[Uu]nknown argument `chain`/);

    const after = await prisma.lodging.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.lat).toBeNull();
    expect(after.lon).toBeNull();
    expect(after.city).toBeNull();
    expect(after.chainId).toBeNull();
  });

  it("the shape the fix needs — a scalar chainId — stores everything", async () => {
    const row = await prisma.lodging.create({
      data: { userId, name: `${TAG}-fixed`, type: "hotel" },
    });

    const written = await prisma.lodging.updateMany({
      where: { id: row.id, lat: null, lon: null },
      data: { lat: 48.1, lon: 11.6, city: "München", chainId },
    });

    expect(written.count).toBe(1);
    const after = await prisma.lodging.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.lat).toBeCloseTo(48.1);
    expect(after.chainId).toBe(chainId);
  });
});
