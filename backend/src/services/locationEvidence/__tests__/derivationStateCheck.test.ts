import { prisma } from "../../../db";

/**
 * `travtrack_derivation_state.last_error_kind` is a closed vocabulary, never a
 * message (TravTrack plan E1/E6): `disabled | database | reducer`, or null.
 * The database holds it, as it holds every other closed vocabulary of E1.
 */
describe("travtrack_derivation_state.last_error_kind", () => {
  let userId: string;

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: `derivation-check-${Date.now()}`, passwordHash: "synthetic-test-hash" },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const write = (lastErrorKind: string | null) =>
    prisma.travTrackDerivationState.upsert({
      where: { userId },
      create: { userId, lastErrorKind },
      update: { lastErrorKind },
    });

  it.each([null, "disabled", "database", "reducer"])("takes %p", async (kind) => {
    await expect(write(kind)).resolves.toMatchObject({ lastErrorKind: kind });
  });

  it.each(["Error: connection refused", "timeout", ""])("refuses %p", async (kind) => {
    await expect(write(kind)).rejects.toThrow(/last_error_kind_check/);
  });
});
