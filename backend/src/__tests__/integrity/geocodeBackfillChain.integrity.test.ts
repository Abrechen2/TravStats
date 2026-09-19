/**
 * Auditor I2, data-integrity audit 2026-09-19 — finding 2, and its fix.
 *
 * `services/lodging/geocodeBackfill.ts` wrote the geocoder's answer with
 * `prisma.lodging.updateMany({ where: { id, lat: null, lon: null }, data: {
 *   lat, lon, …, ...(coords.chainName && row.chainId === null
 *        ? { chain: { connect: { name: coords.chainName } } } : {}) } })`.
 *
 * `updateMany` takes `LodgingUpdateManyMutationInput`, which carries `chainId`
 * and no `chain` relation (src/generated/prisma/models/Lodging.ts:615). The
 * nested `connect` was therefore an unknown argument. TypeScript did not catch
 * it — the excess-property check does not reach a conditionally spread object
 * literal — so it was a RUNTIME failure, and the per-row `catch` above it
 * turned the failure into a `warn` line and moved on.
 *
 * Consequence, for exactly the rows where the geocoder DID identify a chain
 * and the house had none yet: the coordinates were thrown away too. Nothing
 * stored, nothing shown to the user, and the row's `geocodeAttemptedAt` was
 * already stamped, so it went to the back of the queue and failed the same way
 * next time.
 *
 * The fix resolves the chain to an id BEFORE the write and passes the scalar.
 * Test 2 below pins the write the service builds now; test 3 pins that an
 * unknown chain name costs the row nothing but its chain. Test 4 pins the
 * shape that used to be built, and that it would still throw — the reason
 * this cannot come back by accident is that nothing type-checks it, so
 * something has to.
 */
import { prisma } from "../../db";
import { isDatabaseError } from "../../services/lodging/geocodeBackfill";

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

/**
 * The write the service performs, with the chain already resolved to an id —
 * byte-for-byte the shape `geocodeBackfill.ts` builds since the fix.
 */
async function writePosition(lodgingId: string, resolvedChainId: number | null) {
  return prisma.lodging.updateMany({
    where: { id: lodgingId, lat: null, lon: null },
    data: {
      lat: 48.1,
      lon: 11.6,
      city: "München",
      ...(resolvedChainId !== null ? { chainId: resolvedChainId } : {}),
    },
  });
}

describe("the geocode backfill's position write", () => {
  it("stores the position when the geocoder named NO chain (the control)", async () => {
    const row = await prisma.lodging.create({
      data: { userId, name: `${TAG}-no-chain`, type: "hotel" },
    });

    const written = await writePosition(row.id, null);

    expect(written.count).toBe(1);
    const after = await prisma.lodging.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.lat).toBeCloseTo(48.1);
  });

  it("stores the position AND the chain when the geocoder named one the catalogue knows", async () => {
    const row = await prisma.lodging.create({
      data: { userId, name: `${TAG}-with-chain`, type: "hotel" },
    });

    // What the service now does first: name -> id, outside the write.
    const chain = await prisma.lodgingChain.findUnique({
      where: { name: `${TAG}-Chain` },
      select: { id: true },
    });
    expect(chain).not.toBeNull();

    const written = await writePosition(row.id, chain?.id ?? null);

    expect(written.count).toBe(1);
    const after = await prisma.lodging.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.lat).toBeCloseTo(48.1);
    expect(after.lon).toBeCloseTo(11.6);
    expect(after.city).toBe("München");
    expect(after.chainId).toBe(chainId);
  });

  it("still stores the POSITION when the chain name is one the catalogue does not know", async () => {
    const row = await prisma.lodging.create({
      data: { userId, name: `${TAG}-unknown-chain`, type: "hotel" },
    });

    const chain = await prisma.lodgingChain.findUnique({
      where: { name: `${TAG}-no-such-chain` },
      select: { id: true },
    });
    expect(chain).toBeNull();

    const written = await writePosition(row.id, chain?.id ?? null);

    // The position is the point of the pass. An unknown chain name is not a
    // reason to store nothing — which is precisely what the defect did.
    expect(written.count).toBe(1);
    const after = await prisma.lodging.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.lat).toBeCloseTo(48.1);
    expect(after.chainId).toBeNull();
  });

  it("the OLD shape still throws — and the throw is recognised as ours, not the geocoder's", async () => {
    const row = await prisma.lodging.create({
      data: { userId, name: `${TAG}-old-shape`, type: "hotel" },
    });

    const write = prisma.lodging.updateMany({
      where: { id: row.id, lat: null, lon: null },
      data: {
        lat: 48.1,
        lon: 11.6,
        city: "München",
        ...({ chain: { connect: { name: `${TAG}-Chain` } } } as unknown as object),
      },
    });

    const err = await write.then(
      () => null,
      (e: unknown) => e
    );
    expect(err).not.toBeNull();
    expect(String(err)).toMatch(/[Uu]nknown argument `chain`/);
    // The second half of the fix: the per-row catch logs this at `error`, not
    // `warn`. Logging it as a transient miss is what let the defect run.
    expect(isDatabaseError(err)).toBe(true);
    expect(isDatabaseError(new Error("fetch failed"))).toBe(false);

    const after = await prisma.lodging.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.lat).toBeNull();
  });
});
