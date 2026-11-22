import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The web (and the Companion) read an entry's origin from the entry itself: every domain's detail
 * and list answer must carry `provenance` / `rememberedNote`, or the "aus der Erinnerung" marker
 * silently never shows (spec 2026-11-22-remembered-facts).
 */
describe("remembered facts — every domain's reads carry the origin", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  const ids: Record<string, string> = {};
  const mark = { provenance: "remembered", rememberedNote: "irgendwann im Sommer" };
  const leg = {
    depStationName: "A",
    depLat: 50,
    depLon: 8,
    arrStationName: "B",
    arrLat: 51,
    arrLon: 9,
    departureTime: new Date("2001-07-01T08:00:00Z"),
  };

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: `rf-rd-${stamp}`, passwordHash: await hashPassword("test-password") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    ids.rail = (await prisma.railJourney.create({ data: { userId, ...leg, ...mark } })).id;
    ids.bus = (await prisma.busJourney.create({ data: { userId, ...leg, ...mark } })).id;
    ids.ferry = (await prisma.ferryJourney.create({ data: { userId, ...leg, ...mark } })).id;
    ids.rental = (
      await prisma.rentalBooking.create({
        data: {
          userId,
          provider: "Sixt",
          pickupStationName: "A",
          pickupLat: 50,
          pickupLon: 8,
          pickupTimezone: "Europe/Berlin",
          returnStationName: "B",
          returnLat: 51,
          returnLon: 9,
          returnTimezone: "Europe/Berlin",
          pickupTime: new Date("2001-07-01T08:00:00Z"),
          returnTime: new Date("2001-07-08T08:00:00Z"),
          ...mark,
        },
      })
    ).id;
    ids.cruise = (await prisma.cruise.create({ data: { userId, ...mark } })).id;
    ids.trip = (await prisma.trip.create({ data: { userId, name: "Sommer 2001", ...mark } })).id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  const get = (path: string) => request(app).get(`/api/v1${path}`).set("Cookie", cookie);
  const body = (b: { data?: unknown }): Record<string, unknown> =>
    ((b.data ?? b) as Record<string, unknown>) ?? {};
  const unwrap = (res: { body: { data?: unknown } }): Record<string, unknown> => {
    const b = body(res.body);
    return (b.journey ?? b.ride ?? b.rental ?? b.cruise ?? b.trip ?? b) as Record<string, unknown>;
  };

  it.each([
    ["rail", "/rail"],
    ["bus", "/bus"],
    ["ferry", "/ferry"],
    ["rental", "/rentals"],
    ["cruise", "/cruises"],
    ["trip", "/trips"],
  ])("%s: the detail answer says it was remembered", async (key, base) => {
    const res = await get(`${base}/${ids[key]}`);
    expect(res.status).toBe(200);
    const row = unwrap(res);
    expect(row.provenance).toBe("remembered");
    expect(row.rememberedNote).toBe("irgendwann im Sommer");
  });
});
