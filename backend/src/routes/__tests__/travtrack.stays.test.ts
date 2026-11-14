import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, storePoint, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";

/**
 * A night at Home is one stay across midnight (TravTrack day view): the phone falls silent
 * within a minute of arriving and speaks again off the doorstep, and neither day may show the
 * silence as a hole. Synthetic coordinates; Seoul is UTC+9.
 */

const PREFIX = "travtrack-stays-";
const MIN = 60_000;
const EVENING = Date.parse("2026-10-11T11:00:00Z"); // 20:00 on 11 Oct, Seoul
const MORNING = Date.parse("2026-10-11T22:30:00Z"); // 07:30 on 12 Oct
const MIDNIGHT = Date.parse("2026-10-11T15:00:00Z"); // 00:00 on 12 Oct
const NEXT_MIDNIGHT = Date.parse("2026-10-12T15:00:00Z");
const HOME = { name: "Wohnung", lat: 37.55, lon: 126.99, zone: "Asia/Seoul" };
/** 180 m north of Home: outside its 150 m circle, inside the 100 m band around it. */
const DOORSTEP_LAT = 37.55 + 180 / 111_195;

type DayBody = {
  stops: Array<{
    fromMs: number;
    untilMs: number;
    place: { name: string } | null;
    openStart?: true;
    openEnd?: true;
  }>;
  coverage: Array<{ fromMs: number; untilMs: number; state: string }>;
  context: Array<{ kind: string; fromMs: number; untilMs: number }>;
};

describe("TravTrack: a night at Home across midnight", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let cookie: string;

  const day = async (date: string): Promise<DayBody> =>
    (await request(app).get("/api/v1/travtrack/day").query({ date }).set("Cookie", cookie)).body;

  const store = async () => {
    for (let i = 0; i < 5; i++) {
      await storePoint(userId, { t: EVENING + i * 15_000, lat: 37.5501, lon: 126.99 });
    }
    await storePoint(userId, { t: MORNING, lat: DOORSTEP_LAT, lon: 126.99 });
    await storePoint(userId, { t: MORNING + 2 * MIN, lat: DOORSTEP_LAT + 0.0005, lon: 126.99 });
  };

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.userSettings.create({
      data: { userId, data: { display: { timezone: "Asia/Seoul" } }, homePlace: HOME },
    });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("an overnight stay at Home is one stop on both days, clipped to each (was: no stop either day)", async () => {
    await store();
    const evening = await day("2026-10-11");
    expect(evening.stops).toHaveLength(1);
    expect(evening.stops[0]).toMatchObject({
      fromMs: EVENING,
      untilMs: MIDNIGHT,
      place: { name: "Wohnung" },
      openEnd: true,
    });
    expect(evening.stops[0].openStart).toBeUndefined();
    const morning = await day("2026-10-12");
    expect(morning.stops[0]).toMatchObject({
      fromMs: MIDNIGHT,
      untilMs: MORNING,
      place: { name: "Wohnung" },
      openStart: true,
    });
    expect(morning.stops[0].openEnd).toBeUndefined();
  });

  it("coverage shows no noData under an inferred stay, and the timeline has no hole at Home", async () => {
    await store();
    const evening = await day("2026-10-11");
    expect(evening.coverage.filter((c) => c.state === "noData" && c.untilMs > EVENING)).toEqual([]);
    const morning = await day("2026-10-12");
    expect(morning.coverage.filter((c) => c.state === "noData" && c.fromMs < MORNING)).toEqual([]);
    const home = morning.context.filter((c) => c.kind === "home");
    expect(home).toHaveLength(1);
    expect(home[0]).toMatchObject({ fromMs: MIDNIGHT, untilMs: MORNING });
  });

  it("a privacy zone within 500 m of the silence vetoes the stay across midnight", async () => {
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Nachbar", lat: 37.55 + 300 / 111_195, lon: 126.99, radiusM: 40 },
    });
    await store();
    expect((await day("2026-10-11")).stops).toEqual([]);
    expect((await day("2026-10-12")).stops).toEqual([]);
  });

  it("a deleted range inside the night vetoes the stay across midnight", async () => {
    await store();
    await prisma.travTrackDeletedRange.create({
      data: { userId, fromAt: new Date(MIDNIGHT), toAt: new Date(MIDNIGHT + 60 * MIN) },
    });
    expect((await day("2026-10-11")).stops).toEqual([]);
    expect((await day("2026-10-12")).stops).toEqual([]);
  });

  it("a pause the phone reported inside the night vetoes the stay across midnight", async () => {
    await store();
    await prisma.travTrackGap.create({
      data: {
        userId,
        deviceId: "phone-1",
        fromAt: new Date(MIDNIGHT),
        toAt: new Date(MIDNIGHT + 60 * MIN),
        reason: "recorderSilent",
      },
    });
    expect((await day("2026-10-11")).stops).toEqual([]);
  });
});
