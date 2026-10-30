import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { loadAllTests, recordTest } from "../tests";

/** forgejo#392: a verdict is one row per scope, even when two tests finish together. */
describe("external service test results are one row per scope", () => {
  let userId: string;
  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: {
          username: `est-${Date.now()}`,
          passwordHash: await hashPassword("pw-123456"),
          isActive: true,
        },
      })
    ).id;
    await prisma.externalServiceTest.deleteMany({ where: { serviceId: "est-svc" } });
  });
  afterAll(async () => {
    await prisma.externalServiceTest.deleteMany({ where: { serviceId: "est-svc" } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("two concurrent first tests of an account leave one row, the later verdict", async () => {
    await Promise.all([
      recordTest(userId, "est-svc", false, "auth"),
      recordTest(userId, "est-svc", true, null),
    ]);
    expect(
      await prisma.externalServiceTest.count({ where: { userId, serviceId: "est-svc" } })
    ).toBe(1);
    await recordTest(userId, "est-svc", false, "quota");
    expect((await loadAllTests(userId)).get("est-svc")).toMatchObject({
      ok: false,
      reason: "quota",
    });
  });

  it("two concurrent first tests of the instance leave one row, and the database refuses a second", async () => {
    await Promise.all([
      recordTest(null, "est-svc", false, "timeout"),
      recordTest(null, "est-svc", true, null),
    ]);
    expect(
      await prisma.externalServiceTest.count({ where: { userId: null, serviceId: "est-svc" } })
    ).toBe(1);
    await expect(
      prisma.externalServiceTest.create({ data: { userId: null, serviceId: "est-svc", ok: true } })
    ).rejects.toThrow();
    await expect(
      prisma.externalServiceTest.create({ data: { userId, serviceId: "est-svc", ok: true } })
    ).rejects.toThrow();
  });
});
