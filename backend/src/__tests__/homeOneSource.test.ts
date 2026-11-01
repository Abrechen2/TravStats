import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../index";
import { prisma } from "../db";
import { homeCircle } from "../services/travtrack/shareNarrow";

/**
 * Home as one record (plan `2026-11-01-home-one-source`, S1): the residence of
 * the current home period IS `homePlace`; the legacy column is a fallback.
 */
const KOELN = { name: "Köln", lat: 50.9375, lon: 6.9603 };
const MUENCHEN = { name: "München", lat: 48.1374, lon: 11.5755 };
const LEGACY = { name: "Bergen", lat: 60.39, lon: 5.32, zone: "Europe/Oslo" };

const period = (
  fromDate: string,
  toDate: string | null,
  residence: { name: string; lat: number; lon: number } | null
) => ({
  fromDate,
  toDate,
  residence,
  residenceConfirmed: residence !== null,
  airports: [{ code: "CGN", primary: true }],
});

describe("home as one source", () => {
  let cookie: string[];
  let userId: string;

  const clean = async (): Promise<void> => {
    await prisma.userSettings.deleteMany();
    await prisma.user.deleteMany();
  };
  const setData = (periods: unknown[], homePlace: unknown = null) =>
    prisma.userSettings.upsert({
      where: { userId },
      update: { data: { homePeriods: periods }, homePlace: homePlace as never },
      create: { userId, data: { homePeriods: periods }, homePlace: homePlace as never },
    });
  const get = () => request(app).get("/api/v1/settings/personal").set("Cookie", cookie).expect(200);
  const put = (body: object) =>
    request(app).put("/api/v1/settings/personal").set("Cookie", cookie).send(body);
  const move = (body: object) =>
    request(app).post("/api/v1/settings/home-airports/periods").set("Cookie", cookie).send(body);

  beforeEach(async () => {
    await clean();
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: "home-one-source", password: "password123" })
      .expect(201);
    cookie = [res.headers["set-cookie"]].flat();
    userId = (await prisma.user.findFirstOrThrow()).id;
  });
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("GET derives homePlace from the current period's residence, not the legacy column", async () => {
    await setData([period("2020-01-01", null, KOELN)], LEGACY);
    const body = (await get()).body;
    expect(body.homePlaceSource).toBe("period");
    expect(body.homePlace).toMatchObject(KOELN);
    expect(body.homePlace.zone).toBe("Europe/Berlin");
  });

  it("GET falls back to the legacy column when no current period has a residence", async () => {
    await setData([period("2020-01-01", null, null)], LEGACY);
    expect((await get()).body).toMatchObject({ homePlace: LEGACY, homePlaceSource: "legacy" });
    await setData([], LEGACY);
    expect((await get()).body).toMatchObject({ homePlace: LEGACY, homePlaceSource: "legacy" });
  });

  it("GET after a move (two periods) returns the new residence", async () => {
    await setData([
      period("2015-01-01", "2022-06-01", KOELN),
      period("2022-06-01", null, MUENCHEN),
    ]);
    expect((await get()).body.homePlace).toMatchObject(MUENCHEN);
  });

  it("PUT homePlace writes the current period's residence and keeps its airports and dates", async () => {
    await setData([period("2020-01-01", null, KOELN)]);
    const res = await put({ homePlace: { ...MUENCHEN, zone: null } }).expect(200);
    expect(res.body).toMatchObject({ homePlaceSource: "period", homePlace: MUENCHEN });
    const stored = (await prisma.userSettings.findUniqueOrThrow({ where: { userId } })).data as {
      homePeriods: ReturnType<typeof period>[];
    };
    expect(stored.homePeriods).toHaveLength(1);
    expect(stored.homePeriods[0]).toMatchObject({
      fromDate: "2020-01-01",
      toDate: null,
      residence: MUENCHEN,
      airports: [{ code: "CGN", primary: true }],
    });
  });

  it("PUT homePlace without a current period keeps the legacy write", async () => {
    const res = await put({ homePlace: LEGACY }).expect(200);
    expect(res.body).toMatchObject({ homePlace: LEGACY, homePlaceSource: "legacy" });
  });

  it("PUT homePlace null is refused while a period holds the residence", async () => {
    await setData([period("2020-01-01", null, KOELN)]);
    const res = await put({ homePlace: null }).expect(409);
    expect(res.body.code).toBe("HOME_PLACE_IS_PERIOD");
  });

  it("share narrowing reads the derived home, not a stale legacy column", async () => {
    await setData([period("2020-01-01", null, KOELN)], LEGACY);
    const circle = await homeCircle(prisma, userId);
    expect(circle).toMatchObject({ lat: KOELN.lat, lon: KOELN.lon });
  });

  describe("POST /settings/home-airports/periods (a move)", () => {
    const body = (clientRef: string, fromDate = "2024-05-01") => ({
      fromDate,
      residence: MUENCHEN,
      airports: [{ code: "CGN", primary: true }],
      clientRef,
    });

    it("appends a period and closes the running one at the new start", async () => {
      await setData([period("2020-01-01", null, KOELN)]);
      const res = await move(body("a")).expect(200);
      expect(res.body.periods).toHaveLength(2);
      expect(res.body.periods[0]).toMatchObject({ fromDate: "2020-01-01", toDate: "2024-05-01" });
      expect(res.body.periods[1]).toMatchObject({ fromDate: "2024-05-01", toDate: null });
      expect((await get()).body.homePlace).toMatchObject(MUENCHEN);
    });

    it("replaying the same clientRef adds no second period", async () => {
      await setData([period("2020-01-01", null, KOELN)]);
      const first = await move(body("same")).expect(200);
      const again = await move(body("same")).expect(200);
      expect(again.body.periods).toHaveLength(2);
      expect(again.body).toEqual(first.body);
    });

    it("refuses a start that is not after the running period's start with 409 HOME_PERIOD_OVERLAP", async () => {
      await setData([period("2020-01-01", null, KOELN)]);
      const res = await move(body("o", "2020-01-01")).expect(409);
      expect(res.body).toMatchObject({ error: "HOME_PERIOD_OVERLAP", code: "HOME_PERIOD_OVERLAP" });
      expect((await get()).body.homePlace).toMatchObject(KOELN);
    });

    it("refuses an unknown home airport with 400 carrying code HOME_AIRPORT_UNKNOWN", async () => {
      const res = await move({ ...body("u"), airports: [{ code: "ZZZZ", primary: true }] }).expect(
        400
      );
      expect(res.body).toMatchObject({
        error: "HOME_AIRPORT_UNKNOWN",
        code: "HOME_AIRPORT_UNKNOWN",
      });
    });

    it("creates the first period when there is none", async () => {
      const res = await move(body("first")).expect(200);
      expect(res.body.periods).toHaveLength(1);
      expect(res.body.periods[0]).toMatchObject({ fromDate: "2024-05-01", toDate: null });
    });
  });
});
