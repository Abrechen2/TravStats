import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma, observeQueries } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  installProvenanceNoticeTriggers,
  setNoticeDebounceMs,
  sweepAllAccounts,
} from "../../services/provenance/noticeTriggers";

/**
 * The inbox badge polls every 30 seconds. It must read stored rows — one indexed count — and the
 * notices must be brought up to date when the DATA changes, not when somebody asks.
 */
describe("provenance notice badge", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let tripId: string;
  let uninstall: () => void;

  const count = async (): Promise<number> =>
    (await request(app).get("/api/v1/provenance/notices/count").set("Cookie", cookie)).body.data
      .count;
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: `rf-bd-${stamp}`, passwordHash: await hashPassword("test-password") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    setNoticeDebounceMs(50);
    uninstall = installProvenanceNoticeTriggers();
  });

  afterAll(async () => {
    uninstall();
    setNoticeDebounceMs(5_000);
    await prisma.user.delete({ where: { id: userId } });
  });

  it("raises the notice when the entry is WRITTEN, and the count only reads it", async () => {
    tripId = (
      await prisma.trip.create({
        data: {
          userId,
          name: "Sommer 1999",
          provenance: "remembered",
          startDate: new Date("1999-07-01T00:00:00Z"),
          endDate: new Date("1999-07-10T00:00:00Z"),
        },
      })
    ).id;
    expect(await count()).toBe(0);
    await prisma.flight.create({
      data: {
        userId,
        tripId,
        depIata: "FRA",
        depLat: 50,
        depLon: 8,
        arrIata: "LIS",
        arrLat: 38,
        arrLon: -9,
        status: "flown",
        departureTime: new Date("1999-09-09T08:00:00Z"),
        provenance: "recorded",
      },
    });
    await settle();
    expect(await count()).toBe(1);
  });

  it("the badge's poll makes one query and recomputes nothing", async () => {
    const seen: string[] = [];
    const stop = observeQueries((q) => seen.push(`${q.model}.${q.operation}`));
    await count();
    stop();
    // Auth bookkeeping aside, the only entry or notice query is the one indexed count.
    expect(seen.filter((q) => !/^(RevokedSession|User|undefined)\./.test(q))).toEqual([
      "ProvenanceNotice.count",
    ]);
  });

  it("a change of the entry that removes the contradiction resolves the notice by itself", async () => {
    await prisma.trip.update({
      where: { id: tripId },
      data: { endDate: new Date("1999-10-01T00:00:00Z") },
    });
    await settle();
    expect(await count()).toBe(0);
  });

  it("the boot sweep catches what no write named", async () => {
    await prisma.trip.update({
      where: { id: tripId },
      data: { endDate: new Date("1999-07-10T00:00:00Z") },
    });
    await settle();
    await prisma.provenanceNotice.deleteMany({ where: { userId } });
    expect(await count()).toBe(0);
    await sweepAllAccounts();
    expect(await count()).toBe(1);
  });
});
