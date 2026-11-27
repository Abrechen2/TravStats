import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";

import { prisma } from "../../../db";

/**
 * A `purposeKey` written directly (not through `purpose`) passes the same check in the Prisma hook:
 * no path stores an unknown key or another account's custom purpose.
 */
describe("purpose key: direct writes are validated in the hook", () => {
  const stamp = Date.now();
  let mine: string;
  let theirs: string;
  let theirCustom: string;
  let myCustom: string;

  const flight = (userId: string, extra: Record<string, unknown> = {}) =>
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

  beforeAll(async () => {
    mine = (await prisma.user.create({ data: { username: `pkw-a-${stamp}`, passwordHash: "x" } }))
      .id;
    theirs = (await prisma.user.create({ data: { username: `pkw-b-${stamp}`, passwordHash: "x" } }))
      .id;
    const c = { kind: "business", color: "#000000", icon: "star" };
    myCustom = (await prisma.customPurpose.create({ data: { userId: mine, name: "Mein", ...c } }))
      .id;
    theirCustom = (
      await prisma.customPurpose.create({ data: { userId: theirs, name: "Fremd", ...c } })
    ).id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [mine, theirs] } } });
  });

  it("refuses an unknown built-in key", async () => {
    await expect(flight(mine, { purposeKey: "builtin:nope" })).rejects.toMatchObject({
      code: "PURPOSE_UNKNOWN",
    });
  });

  it("refuses another account's custom key, on create and on update", async () => {
    await expect(flight(mine, { purposeKey: `custom:${theirCustom}` })).rejects.toMatchObject({
      code: "PURPOSE_UNKNOWN",
    });
    const f = await flight(mine);
    await expect(
      prisma.flight.update({ where: { id: f.id }, data: { purposeKey: `custom:${theirCustom}` } })
    ).rejects.toMatchObject({ code: "PURPOSE_UNKNOWN" });
    await expect(
      prisma.flight.updateMany({
        where: { id: f.id },
        data: { purposeKey: { set: `custom:${theirCustom}` } },
      })
    ).rejects.toMatchObject({ code: "PURPOSE_UNKNOWN" });
  });

  it("a valid key brings its kind along; the owner's own custom key is accepted", async () => {
    const a = await flight(mine, { purposeKey: "builtin:vacation" });
    expect(a).toMatchObject({ purpose: "private", purposeKey: "builtin:vacation" });
    const b = await flight(mine, { purposeKey: `custom:${myCustom}` });
    expect(b).toMatchObject({ purpose: "business", purposeKey: `custom:${myCustom}` });
  });

  it("refuses a key that contradicts the kind or key written beside it, or a null kind", async () => {
    await expect(
      flight(mine, { purpose: "private", purposeKey: "builtin:trade_fair" })
    ).rejects.toMatchObject({ code: "PURPOSE_UNKNOWN" });
    await expect(
      flight(mine, { purpose: "builtin:vacation", purposeKey: "builtin:health" })
    ).rejects.toMatchObject({ code: "PURPOSE_UNKNOWN" });
    await expect(
      flight(mine, { purpose: null, purposeKey: "builtin:health" })
    ).rejects.toMatchObject({
      code: "PURPOSE_UNKNOWN",
    });
    const ok = await flight(mine, { purpose: "business", purposeKey: "builtin:trade_fair" });
    expect(ok.purposeKey).toBe("builtin:trade_fair");
  });
});
