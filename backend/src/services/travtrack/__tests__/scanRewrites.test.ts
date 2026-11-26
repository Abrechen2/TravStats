import { prisma, observeQueries } from "../../../db";
import { setLocationProvider } from "../../locationProvider/provider";
import { markAllPointDaysDirty } from "../dirtyDays";
import { travTrackYears } from "../everyday/view";
import { collectRemoved } from "../removedHistory";
import { Prisma } from "../../../prisma";
import { travTrackSwitches } from "./switches";

/**
 * Perf audit 2026-11, item 6: three reads walked an account's whole TravTrack
 * history (measured on 900k synthetic points: years 507 ms -> 0.1 ms, every
 * point day 168 ms -> 8.6 ms, a zone's removal record 4 scans -> 1). The
 * rewrites must answer exactly what the scans answered.
 */
const USERNAME = "scan-rewrites-user";
let userId = "";
const switches = travTrackSwitches();

async function point(iso: string, lat = 50, lon = 8): Promise<void> {
  const ms = Date.parse(iso);
  await prisma.$executeRaw`
    INSERT INTO travtrack_points (id, user_id, t, t_s, lat, lon, origin, origin_ref)
    VALUES (gen_random_uuid()::text, ${userId}, ${new Date(ms)}, ${Math.floor(ms / 1000)},
            ${lat}, ${lon}, 'companion', ${`${ms}:${lat}:${lon}`})`;
}

beforeAll(async () => {
  await switches.set({ beta: true, config: true });
  await prisma.user.deleteMany({ where: { username: USERNAME } });
  userId = (await prisma.user.create({ data: { username: USERNAME, passwordHash: "x" } })).id;
  await prisma.userSettings.create({
    data: {
      userId,
      data: { display: { timezone: "Europe/Berlin" } },
      locationProvider: "travtrack",
    },
  });
  await setLocationProvider(userId, "travtrack");
  await point("2023-06-01T10:00:00Z");
  await point("2023-06-01T10:10:00Z");
  // 00:30 on 1 January 2025 in Berlin: a 2025 point, not a 2024 one.
  await point("2024-12-31T23:30:00Z", 51, 9);
  await point("2026-03-01T08:00:00Z", 51, 9);
});

afterAll(async () => {
  await switches.restore();
  await prisma.user.deleteMany({ where: { username: USERNAME } });
});

describe("the TravTrack scan rewrites", () => {
  it("names the profile-zone years by index probes, skipping a year without points", async () => {
    expect(await travTrackYears(userId)).toEqual([2023, 2025, 2026]);
  });

  it("marks exactly the UTC days that hold a point, none in between", async () => {
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    await prisma.$transaction((tx) => markAllPointDaysDirty(tx, userId));
    const days = await prisma.travTrackDirtyDay.findMany({
      where: { userId },
      orderBy: { day: "asc" },
    });
    expect(days.map((d) => d.day.toISOString().slice(0, 10))).toEqual([
      "2023-06-01",
      "2024-12-31",
      "2026-03-01",
    ]);
  });

  it("collects a removal's count, days, spans and keys in one query", async () => {
    let raws = 0;
    const stop = observeQueries((q) => {
      if (q.model === undefined) raws += 1;
    });
    const removed = await prisma.$transaction((tx) =>
      collectRemoved(tx, userId, Prisma.sql`lat BETWEEN 49.5 AND 50.5`)
    );
    stop();
    expect(raws).toBe(1);
    expect(removed.days).toEqual(["2023-06-01"]);
    expect(removed.spans).toEqual([
      [Date.parse("2023-06-01T10:00:00Z"), Date.parse("2023-06-01T10:10:00Z")],
    ]);
    expect(removed.keys?.size).toBe(2);
  });

  it("returns nothing for a scope without points", async () => {
    const removed = await prisma.$transaction((tx) =>
      collectRemoved(tx, userId, Prisma.sql`lat > 80`)
    );
    expect(removed).toEqual({ spans: [], days: [], keys: new Set() });
  });
});
