import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, storePoint, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";

/**
 * Stop writes meet the day view's stays (rc.31: the view derived a night across midnight from
 * the day +-24 h and clipped it, the writes derived day by day, so naming the evening part was
 * a 404 and dismissing the morning part stored a day-only stop). The client sends the clipped
 * span the day returned; the name and the dismissal belong to the whole stay.
 */

const PREFIX = "travtrack-stopwrites-";
const MIN = 60_000;
const EVENING = Date.parse("2026-10-11T13:00:00Z"); // 22:00 on 11 Oct, Seoul
const MIDNIGHT = Date.parse("2026-10-11T15:00:00Z");
const MORNING = Date.parse("2026-10-11T22:30:00Z"); // 07:30 on 12 Oct
const LAT = 37.5;
const LON = 127;
const FAR_LAT = 37.6;

type Stop = {
  fromMs: number;
  untilMs: number;
  place: { name: string } | null;
  dismissed?: true;
  openStart?: true;
  openEnd?: true;
};

describe("TravTrack: naming and dismissing a stay across midnight", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let cookie: string;

  const stops = async (date: string): Promise<Stop[]> =>
    (await request(app).get("/api/v1/travtrack/day").query({ date }).set("Cookie", cookie)).body
      .stops;
  const putPlace = (span: { fromMs: number; untilMs: number }, place: object | null) =>
    request(app)
      .put("/api/v1/travtrack/stops/place")
      .set("Cookie", cookie)
      .send({ ...span, place });
  const putDismissed = (span: { fromMs: number; untilMs: number }, dismissed: boolean) =>
    request(app)
      .put("/api/v1/travtrack/stops/dismissed")
      .set("Cookie", cookie)
      .send({ ...span, dismissed });

  const night = async () => {
    for (let i = 0; i < 5; i++) {
      await storePoint(userId, { t: EVENING + i * 15_000, lat: LAT, lon: LON });
    }
    await storePoint(userId, { t: MORNING, lat: LAT, lon: LON });
    await storePoint(userId, { t: MORNING + 2 * MIN, lat: LAT, lon: LON });
    // Away from the stay, so the morning does not read as a longer wait.
    await storePoint(userId, { t: MORNING + 8 * MIN, lat: FAR_LAT, lon: LON });
  };
  /** The evening and the morning part as the day view returns them. */
  const parts = async () => {
    const [evening] = await stops("2026-10-11");
    const [morning] = await stops("2026-10-12");
    return { evening, morning };
  };

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    cookie = `auth_token=${generateToken(userId)}`;
  });
  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.travTrackStopPlace.deleteMany({ where: { userId } });
    await prisma.travTrackStopDismissal.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.userSettings.create({
      data: { userId, data: { display: { timezone: "Asia/Seoul" } } },
    });
  });
  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("the view shows one stay as two clipped parts (the premise)", async () => {
    await night();
    const { evening, morning } = await parts();
    expect(evening).toMatchObject({ fromMs: EVENING, untilMs: MIDNIGHT, openEnd: true });
    expect(morning).toMatchObject({ fromMs: MIDNIGHT, openStart: true });
  });

  it("names the stay through the evening part (was: 404 STOP_NOT_FOUND) and both days show it", async () => {
    await night();
    const { evening } = await parts();
    const res = await putPlace(evening, { name: "Pension" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      fromMs: EVENING,
      untilMs: MIDNIGHT,
      openEnd: true,
      place: { name: "Pension" },
    });
    expect((await stops("2026-10-11"))[0].place?.name).toBe("Pension");
    const morning = (await stops("2026-10-12"))[0];
    expect(morning.place?.name).toBe("Pension");
    expect(morning.openStart).toBe(true);
    expect(await prisma.travTrackStopPlace.count({ where: { userId } })).toBe(1);
  });

  it("names the stay through the morning part and answers that part", async () => {
    await night();
    const { morning } = await parts();
    const res = await putPlace(morning, { name: "Pension" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      fromMs: MIDNIGHT,
      openStart: true,
      place: { name: "Pension" },
    });
    expect((await stops("2026-10-11"))[0].place?.name).toBe("Pension");
  });

  it("removing the name from either part removes it on both days", async () => {
    await night();
    const { evening, morning } = await parts();
    await putPlace(evening, { name: "Pension" });
    const res = await putPlace(morning, null);
    expect(res.status).toBe(200);
    expect(res.body.place).toBeNull();
    expect((await stops("2026-10-11"))[0].place).toBeNull();
    expect(await prisma.travTrackStopPlace.count({ where: { userId } })).toBe(0);
  });

  it("dismisses the stay through the morning part (was: a day-only stop, only day 2 dismissed)", async () => {
    await night();
    const { morning } = await parts();
    const res = await putDismissed(morning, true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fromMs: MIDNIGHT, openStart: true, dismissed: true });
    expect((await stops("2026-10-12"))[0].dismissed).toBe(true);
    expect((await stops("2026-10-11"))[0].dismissed).toBe(true);
  });

  it("restores the stay through the other part", async () => {
    await night();
    const { evening, morning } = await parts();
    await putDismissed(morning, true);
    const res = await putDismissed(evening, false);
    expect(res.status).toBe(200);
    expect(res.body.dismissed).toBeUndefined();
    expect((await stops("2026-10-11"))[0].dismissed).toBeUndefined();
    expect((await stops("2026-10-12"))[0].dismissed).toBeUndefined();
    expect(await prisma.travTrackStopDismissal.count({ where: { userId } })).toBe(0);
  });

  it("a row stored in the old shape (the span of an ordinary stop) still matches", async () => {
    // A stay that lies inside one day, with rows written the way rc.30 wrote them.
    const T0 = Date.parse("2026-10-12T03:00:00Z"); // noon, Seoul
    for (let m = 0; m <= 30; m += 5) {
      await storePoint(userId, {
        t: T0 + m * MIN,
        lat: LAT,
        lon: LON,
        accuracyM: 5,
        motion: "stationary",
      });
    }
    await prisma.travTrackStopPlace.create({
      data: { userId, fromMs: BigInt(T0), untilMs: BigInt(T0 + 30 * MIN), name: "Cafe" },
    });
    await prisma.travTrackStopDismissal.create({
      data: { userId, fromMs: BigInt(T0), untilMs: BigInt(T0 + 30 * MIN) },
    });
    const [stop] = await stops("2026-10-12");
    expect(stop).toMatchObject({ place: { name: "Cafe" }, dismissed: true });
    const res = await putDismissed({ fromMs: stop.fromMs, untilMs: stop.untilMs }, false);
    expect(res.status).toBe(200);
    expect(res.body.dismissed).toBeUndefined();
    expect(await prisma.travTrackStopDismissal.count({ where: { userId } })).toBe(0);
    expect((await putPlace({ fromMs: stop.fromMs, untilMs: stop.untilMs }, null)).status).toBe(200);
    expect(await prisma.travTrackStopPlace.count({ where: { userId } })).toBe(0);
  });

  it("a stop inside one day is unchanged: stored on its own span, no open flags", async () => {
    const T0 = Date.parse("2026-10-12T03:00:00Z");
    for (let m = 0; m <= 30; m += 5) {
      await storePoint(userId, {
        t: T0 + m * MIN,
        lat: LAT,
        lon: LON,
        accuracyM: 5,
        motion: "stationary",
      });
    }
    const [stop] = await stops("2026-10-12");
    const res = await putDismissed({ fromMs: stop.fromMs, untilMs: stop.untilMs }, true);
    expect(res.status).toBe(200);
    expect(res.body.openStart).toBeUndefined();
    expect(res.body.openEnd).toBeUndefined();
    const rows = await prisma.travTrackStopDismissal.findMany({ where: { userId } });
    expect(rows.map((r) => [Number(r.fromMs), Number(r.untilMs)])).toEqual([
      [stop.fromMs, stop.untilMs],
    ]);
  });
});
