import { expectingUniqueConflict, prisma } from "../db";
import { hashPassword } from "../utils/password";
import { dbLogger } from "../utils/logger";

/**
 * A unique violation the caller catches by design (the idempotency key's
 * race, the push claim) is not a database fault and must not reach the error
 * log — but every other one must, or the error log stops meaning anything.
 */
describe("expectingUniqueConflict", () => {
  let userId: string;
  const row = () => ({
    userId,
    clientRef: "dup",
    kind: "bus",
    entityId: "e",
    payloadHash: "0".repeat(64),
  });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "expected_conflict" } });
    userId = (
      await prisma.user.create({
        data: { username: "expected_conflict", passwordHash: await hashPassword("password123") },
      })
    ).id;
    await prisma.clientWriteRef.create({ data: row() });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  afterEach(() => jest.restoreAllMocks());

  const failures = (spy: jest.SpyInstance, operation: string) =>
    spy.mock.calls.filter(([entry]) => (entry as { operation?: string }).operation === operation);

  it("logs an unhandled unique violation as an error", async () => {
    const error = jest.spyOn(dbLogger, "error");
    await expect(prisma.clientWriteRef.create({ data: row() })).rejects.toMatchObject({
      code: "P2002",
    });
    expect(failures(error, "database_query_error")).toHaveLength(1);
  });

  it("demotes the one the caller expects to debug", async () => {
    const error = jest.spyOn(dbLogger, "error");
    const debug = jest.spyOn(dbLogger, "debug");
    await expect(
      expectingUniqueConflict("ClientWriteRef", () => prisma.clientWriteRef.create({ data: row() }))
    ).rejects.toMatchObject({ code: "P2002" });
    expect(failures(error, "database_query_error")).toHaveLength(0);
    expect(failures(debug, "database_expected_conflict")).toHaveLength(1);
  });

  it("holds inside an interactive transaction", async () => {
    const error = jest.spyOn(dbLogger, "error");
    await expect(
      prisma.$transaction((tx) =>
        expectingUniqueConflict("ClientWriteRef", () => tx.clientWriteRef.create({ data: row() }))
      )
    ).rejects.toMatchObject({ code: "P2002" });
    expect(failures(error, "database_query_error")).toHaveLength(0);
  });

  it("still logs a violation on another model than the one expected", async () => {
    const error = jest.spyOn(dbLogger, "error");
    await expect(
      expectingUniqueConflict("PushDelivery", () => prisma.clientWriteRef.create({ data: row() }))
    ).rejects.toMatchObject({ code: "P2002" });
    expect(failures(error, "database_query_error")).toHaveLength(1);
  });
});
