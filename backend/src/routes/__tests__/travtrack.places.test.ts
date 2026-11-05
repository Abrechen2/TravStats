import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, storePoint, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";
import { buildTravTrackDataExport } from "../../services/travtrack/accountExport";
import { generateToken } from "../../utils/jwt";

/**
 * TravTrack's fixed places (spec 2026-11-05-travtrack-fixed-places, S2/S3):
 * the CRUD with its home rules, and what the day view makes of them. Seoul,
 * 12 Oct 2026 (UTC+9): a phone standing still at LAT0 for three hours.
 */

const PREFIX = "travtrack-places-";
const MIN = 60_000;
const DAY_START = Date.parse("2026-10-11T15:00:00Z"); // 12 Oct 00:00 in Seoul
const T0 = DAY_START + 2 * 60 * MIN; // 02:00 local
const LAT0 = 37.5;
const LON0 = 127;
const M = 111_195;
const FAR = LAT0 + 20_000 / M;

const home = (fromDate: string, toDate: string | null, name: string, lat: number) => ({
  fromDate,
  toDate,
  residence: { name, lat, lon: LON0 },
  residenceConfirmed: true,
  airports: [{ code: "ICN", primary: true }],
});

describe("TravTrack — fixed places", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let otherId: string;
  let cookie: string;
  let otherCookie: string;

  const call = (method: "get" | "post" | "put" | "delete", path: string, c = cookie) =>
    request(app)[method](`/api/v1/travtrack${path}`).set("Cookie", c);
  const getDay = (date = "2026-10-12") => call("get", "/day").query({ date });

  const stand = async (fromMin: number, toMin: number, dLatM = 0, wobbleM = 0) => {
    for (let m = fromMin, i = 0; m <= toMin; m += 5, i += 1) {
      await storePoint(userId, {
        t: T0 + m * MIN,
        lat: LAT0 + (dLatM + (i % 2 === 0 ? wobbleM : -wobbleM)) / M,
        lon: LON0,
        accuracyM: 5,
        motion: "stationary",
      });
    }
  };

  const settings = (periods: object[] = [home("2026-01-01", null, "Home", FAR)]) =>
    prisma.userSettings.create({
      data: { userId, data: { display: { timezone: "Asia/Seoul" }, homePeriods: periods } },
    });

  const lodgingStay = async (over: { lat: number | null; lon: number | null }) => {
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel Gangnam", ...over },
    });
    return prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkIn: new Date("2026-10-12T00:00:00Z"),
        checkOut: new Date("2026-10-13T00:00:00Z"),
        checkInAt: new Date(T0 - 60 * MIN),
        checkOutAt: new Date(T0 + 24 * 60 * MIN * 1),
        checkInDate: new Date("2026-10-12T00:00:00Z"),
        checkOutDate: new Date("2026-10-13T00:00:00Z"),
        stayZone: "Asia/Seoul",
      },
    });
  };

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    otherId = await makeUser(`${PREFIX}b`);
    cookie = `auth_token=${generateToken(userId)}`;
    otherCookie = `auth_token=${generateToken(otherId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId, otherId]);
    for (const id of [userId, otherId]) {
      await prisma.travTrackFixedPlace.deleteMany({ where: { userId: id } });
      await prisma.travTrackPlaceSettings.deleteMany({ where: { userId: id } });
      await prisma.lodgingStay.deleteMany({ where: { userId: id } });
      await prisma.lodging.deleteMany({ where: { userId: id } });
      await prisma.userSettings.deleteMany({ where: { userId: id } });
    }
    await settings();
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  describe("CRUD", () => {
    it("lists the derived home first with the default radius, no window, and the lodging default", async () => {
      const res = await call("get", "/places").expect(200);
      expect(res.body).toEqual({
        places: [
          {
            id: "home",
            name: "Home",
            kind: "home",
            lat: FAR,
            lon: LON0,
            radiusM: 150,
            window: null,
          },
        ],
        lodgingAsPlace: { enabled: false, radiusM: 150 },
        lodgingSkipped: 0,
      });
    });

    it("lists home with a null point while no home is known", async () => {
      await prisma.userSettings.deleteMany({ where: { userId } });
      const res = await call("get", "/places").expect(200);
      expect(res.body.places[0]).toMatchObject({ id: "home", kind: "home", lat: null, lon: null });
    });

    it("creates, replaces and deletes a work place; any number of them", async () => {
      const window = { days: [1, 2, 3, 4, 5], from: "08:00", until: "17:00" };
      const made = await call("post", "/places")
        .send({ name: "Office", kind: "work", lat: LAT0, lon: LON0, window })
        .expect(201);
      expect(made.body).toMatchObject({ name: "Office", kind: "work", radiusM: 150, window });
      expect(made.body.id).not.toBe("home");
      await call("post", "/places")
        .send({ name: "Gym", kind: "custom", lat: LAT0, lon: LON0, radiusM: 60 })
        .expect(201);
      const put = await call("put", `/places/${made.body.id}`)
        .send({ name: "HQ", kind: "work", lat: LAT0, lon: LON0, radiusM: 300, window: null })
        .expect(200);
      expect(put.body).toMatchObject({ id: made.body.id, name: "HQ", radiusM: 300, window: null });
      const list = await call("get", "/places").expect(200);
      expect(list.body.places.map((p: { name: string }) => p.name)).toEqual(["Home", "HQ", "Gym"]);
      await call("delete", `/places/${made.body.id}`).expect(204);
      await call("delete", `/places/${made.body.id}`).expect(404);
    });

    it("refuses a second home point: kind home answers 400 homeIsDerived on create", async () => {
      const res = await call("post", "/places")
        .send({ name: "Elsewhere", kind: "home", lat: LAT0, lon: LON0 })
        .expect(400);
      expect(res.body.error).toBe("homeIsDerived");
      expect(await prisma.travTrackFixedPlace.count({ where: { userId } })).toBe(0);
    });

    it("refuses to delete home (400 homeIsDerived)", async () => {
      const res = await call("delete", "/places/home").expect(400);
      expect(res.body.error).toBe("homeIsDerived");
    });

    it("home accepts only radius and window, and keeps its point from the home setting", async () => {
      const window = { days: [6, 7], from: "20:00", until: "08:00" };
      const res = await call("put", "/places/home").send({ radiusM: 400, window }).expect(200);
      expect(res.body).toMatchObject({ id: "home", name: "Home", lat: FAR, radiusM: 400, window });
      const moved = await call("put", "/places/home")
        .send({ radiusM: 400, window: null, lat: LAT0, lon: LON0 })
        .expect(400);
      expect(moved.body.error).toBe("validation");
      const again = await call("get", "/places").expect(200);
      expect(again.body.places[0]).toMatchObject({ lat: FAR, radiusM: 400, window });
    });

    it.each([
      ["a radius under 25 m", { radiusM: 10 }],
      ["a radius over 2000 m", { radiusM: 2500 }],
      ["a latitude off the globe", { lat: 91 }],
      ["an empty name", { name: "  " }],
      ["a window without days", { window: { days: [], from: "08:00", until: "17:00" } }],
      ["a weekday of 8", { window: { days: [8], from: "08:00", until: "17:00" } }],
      ["a time of 25:00", { window: { days: [1], from: "25:00", until: "17:00" } }],
      ["a window of zero length", { window: { days: [1], from: "08:00", until: "08:00" } }],
      ["an unknown field", { homePoint: true }],
    ])("answers 400 validation for %s", async (_label, patch) => {
      const body = { name: "X", kind: "work", lat: LAT0, lon: LON0, ...patch };
      const res = await call("post", "/places").send(body).expect(400);
      expect(res.body.error).toBe("validation");
    });

    it("stores and returns the lodging setting; refuses a bad radius", async () => {
      const put = await call("put", "/places/lodging")
        .send({ enabled: true, radiusM: 200 })
        .expect(200);
      expect(put.body).toEqual({ enabled: true, radiusM: 200 });
      const list = await call("get", "/places").expect(200);
      expect(list.body.lodgingAsPlace).toEqual({ enabled: true, radiusM: 200 });
      await call("put", "/places/lodging").send({ enabled: true, radiusM: 5 }).expect(400);
      await call("put", "/places/lodging").send({ radiusM: 150 }).expect(400);
    });

    it("answers 404 for another account's place", async () => {
      const made = await call("post", "/places", otherCookie)
        .send({ name: "Theirs", kind: "work", lat: LAT0, lon: LON0 })
        .expect(201);
      await call("put", `/places/${made.body.id}`)
        .send({ name: "Mine", kind: "work", lat: LAT0, lon: LON0 })
        .expect(404);
      await call("delete", `/places/${made.body.id}`).expect(404);
      expect((await call("get", "/places").expect(200)).body.places).toHaveLength(1);
    });

    it("answers 403 TRAVTRACK_DISABLED for a write while TravTrack is off", async () => {
      await switches.set({ beta: true, config: false });
      const res = await call("post", "/places")
        .send({ name: "X", kind: "work", lat: LAT0, lon: LON0 })
        .expect(403);
      expect(res.body.code).toBe("TRAVTRACK_DISABLED");
      await call("put", "/places/lodging").send({ enabled: true, radiusM: 150 }).expect(403);
    });

    it("is part of the account export", async () => {
      await call("post", "/places").send({ name: "Office", kind: "work", lat: LAT0, lon: LON0 });
      await call("put", "/places/home").send({ radiusM: 300, window: null });
      await call("put", "/places/lodging").send({ enabled: true, radiusM: 90 });
      const out = await buildTravTrackDataExport(userId);
      expect(out.fixedPlaces.map((p) => p.name)).toEqual(["Office"]);
      expect(out.placeSettings).toMatchObject({ homeRadiusM: 300, lodgingEnabled: true });
    });

    it("goes with the account", async () => {
      const made = await call("post", "/places", otherCookie).send({
        name: "Theirs",
        kind: "work",
        lat: LAT0,
        lon: LON0,
      });
      await call("put", "/places/lodging", otherCookie).send({ enabled: true, radiusM: 90 });
      await prisma.user.delete({ where: { id: otherId } });
      expect(await prisma.travTrackFixedPlace.count({ where: { id: made.body.id } })).toBe(0);
      expect(await prisma.travTrackPlaceSettings.count({ where: { userId: otherId } })).toBe(0);
      otherId = await makeUser(`${PREFIX}b2`);
      otherCookie = `auth_token=${generateToken(otherId)}`;
    });
  });

  describe("the day view folds", () => {
    it("shows a wobbling stand inside a work place as ONE folded stop named after it, raw points unchanged", async () => {
      await stand(0, 180, 0, 70);
      await call("post", "/places").send({ name: "Office", kind: "work", lat: LAT0, lon: LON0 });
      const day = (await getDay().expect(200)).body;
      expect(day.stops).toHaveLength(1);
      expect(day.stops[0]).toMatchObject({
        anchor: { lat: LAT0, lon: LON0 },
        place: { name: "Office", source: "fixed", lat: LAT0, lon: LON0 },
        folded: { fixCount: 37 },
      });
      expect(day.stops[0].place.placeId).toEqual(expect.any(String));
      expect(day.pointCount).toBe(37);
      expect(day.segments.flat()).toHaveLength(37);
    });

    it("keeps the same stand unfolded without the place: no folded field set", async () => {
      await stand(0, 180);
      const day = (await getDay().expect(200)).body;
      expect(day.stops).toHaveLength(1);
      expect(day.stops[0].folded).toBeNull();
      expect(day.stops[0].place).toBeNull();
    });

    it("folds only inside the window in the place's zone (Seoul), not the whole stand", async () => {
      await stand(0, 180); // 02:00-05:00 local
      await call("post", "/places").send({
        name: "Night shift",
        kind: "work",
        lat: LAT0,
        lon: LON0,
        window: { days: [1], from: "03:00", until: "04:00" },
      });
      const day = (await getDay().expect(200)).body;
      // 12 Oct 2026 is a Monday. 03:00-04:00 local is folded; 02:00-03:00 and 04:00-05:00 are not.
      const folded = day.stops.filter((s: { folded: unknown }) => s.folded !== null);
      expect(folded).toHaveLength(1);
      expect(folded[0].fromMs).toBeGreaterThanOrEqual(T0 + 60 * MIN);
      expect(folded[0].untilMs).toBeLessThan(T0 + 120 * MIN);
    });

    it("folds home as it was on THAT day: a past day uses the home valid then, not today's", async () => {
      await prisma.userSettings.deleteMany({ where: { userId } });
      await settings([
        home("2026-01-01", "2026-10-20", "Old flat", LAT0),
        home("2026-10-20", null, "New flat", FAR),
      ]);
      await stand(0, 180, 0, 70);
      const day = (await getDay().expect(200)).body;
      expect(day.stops).toHaveLength(1);
      expect(day.stops[0].place).toMatchObject({
        name: "Old flat",
        source: "fixed",
        placeId: "home",
      });
      expect(day.stops[0].folded).not.toBeNull();
      // The list names today's home.
      expect((await call("get", "/places").expect(200)).body.places[0].name).toBe("New flat");
    });

    it("does not fold home on a day before any home period", async () => {
      await prisma.userSettings.deleteMany({ where: { userId } });
      await settings([home("2026-10-20", null, "New flat", LAT0)]);
      await stand(0, 180, 0, 70);
      const day = (await getDay().expect(200)).body;
      expect(day.stops.every((s: { folded: unknown }) => s.folded === null)).toBe(true);
    });

    it("folds a booked lodging when the setting is on, not when it is off", async () => {
      const stay = await lodgingStay({ lat: LAT0, lon: LON0 });
      await stand(0, 180, 0, 70);
      const off = (await getDay().expect(200)).body;
      expect(off.stops.every((s: { folded: unknown }) => s.folded === null)).toBe(true);
      await call("put", "/places/lodging").send({ enabled: true, radiusM: 150 }).expect(200);
      const on = (await getDay().expect(200)).body;
      expect(on.stops).toHaveLength(1);
      expect(on.stops[0]).toMatchObject({
        place: { name: "Hotel Gangnam", source: "lodging", lodgingStayId: stay.id },
        folded: { fixCount: expect.any(Number) },
        anchor: { lat: LAT0, lon: LON0 },
      });
    });

    it("skips a lodging without coordinates and says how many it skipped", async () => {
      await lodgingStay({ lat: null, lon: null });
      await call("put", "/places/lodging").send({ enabled: true, radiusM: 150 }).expect(200);
      await stand(0, 180);
      const day = (await getDay().expect(200)).body;
      expect(day.stops).toHaveLength(1);
      expect(day.stops[0].folded).toBeNull();
      // The stand's own booking is past; only a current or upcoming one is counted.
      expect((await call("get", "/places").expect(200)).body.lodgingSkipped).toBe(0);
      const house = await prisma.lodging.create({ data: { userId, name: "Future inn" } });
      await prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: house.id,
          checkIn: new Date("2099-05-01T00:00:00Z"),
          checkOut: new Date("2099-05-03T00:00:00Z"),
          checkInDate: new Date("2099-05-01T00:00:00Z"),
          checkOutDate: new Date("2099-05-03T00:00:00Z"),
        },
      });
      expect((await call("get", "/places").expect(200)).body.lodgingSkipped).toBe(1);
    });

    it("lets a fixed place beat a lodging, and an accepted name beat both", async () => {
      await lodgingStay({ lat: LAT0, lon: LON0 });
      await call("put", "/places/lodging").send({ enabled: true, radiusM: 150 });
      await call("post", "/places").send({ name: "Office", kind: "work", lat: LAT0, lon: LON0 });
      await stand(0, 180, 0, 70);
      const first = (await getDay().expect(200)).body.stops[0];
      expect(first.place.source).toBe("fixed");
      await call("put", "/stops/place")
        .send({ fromMs: first.fromMs, untilMs: first.untilMs, place: { name: "My desk" } })
        .expect(200);
      const after = (await getDay().expect(200)).body.stops[0];
      expect(after.place).toMatchObject({ source: "accepted", name: "My desk" });
      expect(after.folded).not.toBeNull();
    });
  });
});
