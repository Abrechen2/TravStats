import { prisma } from "../../../../db";
import { haversineKm } from "../../../../shared/geo/haversine";
import { markTravTrackDaysDirty, SOURCES_BIT } from "../../dirtyDays";
import { readSafeTravTrack } from "../../readSafe";
import { makeUser, wipeTravTrack } from "../../__tests__/fixtures";
import { setDaySourceChoice } from "../choices";
import { deriveDaySource, projectDaySources } from "../store";

/**
 * The stored resolution and the ONE read every derivation goes through
 * (`readSafeTravTrack`): what it keeps, what it re-derives, and on which day.
 */

const PREFIX = "travtrack-bestsource-store-";
const H = 3_600_000;
const MIN = 60_000;
const PHONE = "companion:phone-1";
const GOOGLE = "gpx:takeout";
// The profile clock is Berlin (UTC+2 in August): 10 Aug runs 9 Aug 22:00Z to 10 Aug 22:00Z.
const D10 = Date.parse("2026-08-09T22:00:00Z");
const D11 = D10 + 24 * H;

let ref = 0;
async function put(
  userId: string,
  origin: string,
  tMs: number,
  lat: number,
  lon: number,
  accuracyM: number | null = 8
) {
  ref++;
  await prisma.travTrackPoint.create({
    data: {
      userId,
      t: new Date(tMs),
      tS: Math.floor(tMs / 1000),
      lat,
      lon,
      accuracyM,
      origin,
      originRef: `bs-${ref}`,
      deviceId: origin.startsWith("companion:") ? origin.slice(10) : null,
    },
  });
}

/** A walk east from Munich, one fix per `stepMin` minutes. */
async function walk(
  userId: string,
  origin: string,
  fromMs: number,
  untilMs: number,
  stepMin: number,
  opts: { dLat?: number; accuracyM?: number | null } = {}
) {
  const rows = [];
  for (let t = fromMs; t < untilMs; t += stepMin * MIN) {
    ref++;
    rows.push({
      userId,
      t: new Date(t),
      tS: Math.floor(t / 1000),
      lat: 48.137 + (opts.dLat ?? 0),
      lon: 11.575 + ((t - fromMs) / H) * 0.01,
      accuracyM: opts.accuracyM === undefined ? 8 : opts.accuracyM,
      origin,
      originRef: `bs-${ref}`,
      deviceId: origin.startsWith("companion:") ? origin.slice(10) : null,
    });
  }
  await prisma.travTrackPoint.createMany({ data: rows });
}

const km = (segments: Array<Array<[number, number, number, unknown]>>) =>
  segments.reduce(
    (sum, s) =>
      sum +
      s
        .slice(1)
        .reduce(
          (n, p, i) => n + haversineKm({ lat: s[i][1], lon: s[i][2] }, { lat: p[1], lon: p[2] }),
          0
        ),
    0
  );

describe("TravTrack best source — stored resolution", () => {
  let userId: string;
  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });
  beforeEach(async () => {
    await wipeTravTrack([userId]);
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.userSettings.create({
      data: { userId, data: { display: { timezone: "Europe/Berlin" } } },
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("the read of a mixed day draws only the phone, once resolved (was: both sources, zigzag)", async () => {
    await walk(userId, PHONE, D10 + 8 * H, D10 + 20 * H, 1);
    await walk(userId, GOOGLE, D10 + 8 * H, D10 + 20 * H, 15, { dLat: 0.01, accuracyM: null });
    const before = await readSafeTravTrack(userId, { fromMs: D10, untilMs: D11 }, 50_000);
    expect(new Set(before.segments.flat().map((p) => before.rowOf(p)!.origin))).toEqual(
      new Set([PHONE, GOOGLE])
    );
    await deriveDaySource(userId, "2026-08-10");
    const after = await readSafeTravTrack(userId, { fromMs: D10, untilMs: D11 }, 50_000);
    expect(new Set(after.segments.flat().map((p) => after.rowOf(p)!.origin))).toEqual(
      new Set([PHONE])
    );
    expect(after.sourceExcluded).toBe(48);
  });

  it("an unsupported teleport is neither drawn nor counted in km", async () => {
    await walk(userId, PHONE, D10 + 8 * H, D10 + 12 * H, 5);
    // One fix in Madrid in the middle of a Munich walk.
    await put(userId, PHONE, D10 + 10 * H + 2 * MIN, 40.4, -3.7);
    const window = { fromMs: D10, untilMs: D11 };
    const raw = await readSafeTravTrack(userId, window, 50_000);
    expect(km(raw.segments as never)).toBeGreaterThan(1000);
    const r = await deriveDaySource(userId, "2026-08-10");
    expect(r.resolution!.outlierIds).toHaveLength(1);
    const read = await readSafeTravTrack(userId, window, 50_000);
    expect(km(read.segments as never)).toBeLessThan(5);
    // Reversible: keeping the outliers draws the fix again; the stored point was never touched.
    await setDaySourceChoice(userId, "2026-08-10", { outlierDecision: "keep" });
    const kept = await readSafeTravTrack(userId, window, 50_000);
    expect(km(kept.segments as never)).toBeGreaterThan(1000);
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(49);
  });

  it("cuts days at local midnight on the profile clock, not at UTC midnight", async () => {
    // 23:30 and 00:30 in Berlin are both 9/10 Aug in UTC... and two different local days.
    await walk(userId, PHONE, D11 - 2 * H, D11 - 30 * MIN, 5);
    await walk(userId, GOOGLE, D11 + 30 * MIN, D11 + 2 * H, 10, { accuracyM: null });
    await markTravTrackDaysDirty(prisma as never, userId, ["2026-08-10"]);
    await projectDaySources(userId);
    const rows = await prisma.travTrackDaySource.findMany({
      where: { userId },
      orderBy: { day: "asc" },
    });
    expect(rows.map((r) => [r.day.toISOString().slice(0, 10), r.fromAt.getTime()])).toEqual([
      ["2026-08-10", D10],
      ["2026-08-11", D11],
    ]);
    expect((rows[0].segments as Array<{ source: string }>)[0].source).toBe(PHONE);
    expect((rows[1].segments as Array<{ source: string }>)[0].source).toBe(GOOGLE);
    const dirty = await prisma.travTrackDirtyDay.findFirst({ where: { userId } });
    expect(dirty!.done & SOURCES_BIT).toBe(SOURCES_BIT);
  });

  it("paces every derived day like the other derivation steps (was: unpaced next to the import throttle)", async () => {
    await walk(userId, PHONE, D11 - 2 * H, D11 - 30 * MIN, 5);
    await walk(userId, GOOGLE, D11 + 30 * MIN, D11 + 2 * H, 10, { accuracyM: null });
    await markTravTrackDaysDirty(prisma as never, userId, ["2026-08-10"]);
    let paced = 0;
    const pace = async <T>(work: () => Promise<T>): Promise<T> => {
      paced++;
      return work();
    };
    const out = await projectDaySources(userId, { pace });
    expect(out.days).toBe(1);
    // One UTC dirty day spans two Berlin days: each derivation goes through the pacer.
    expect(paced).toBe(2);
  });

  it("an override re-derives its day only, and hands only that day back to the projections", async () => {
    for (const start of [D10, D11]) {
      await walk(userId, PHONE, start + 8 * H, start + 12 * H, 1);
      await walk(userId, GOOGLE, start + 8 * H, start + 12 * H, 15, {
        dLat: 0.001,
        accuracyM: null,
      });
    }
    await deriveDaySource(userId, "2026-08-10");
    await deriveDaySource(userId, "2026-08-11");
    await prisma.travTrackDirtyDay.updateMany({ where: { userId }, data: { done: 31 } });
    const before = await prisma.travTrackDaySource.findMany({
      where: { userId },
      orderBy: { day: "asc" },
    });

    const summary = await setDaySourceChoice(userId, "2026-08-11", { overrideSource: GOOGLE });
    expect(summary.override).toBe(GOOGLE);
    expect(summary.segments.map((s) => s.source)).toEqual([GOOGLE]);

    const after = await prisma.travTrackDaySource.findMany({
      where: { userId },
      orderBy: { day: "asc" },
    });
    expect(after[0].derivedAt).toEqual(before[0].derivedAt);
    expect(after[1].derivedAt.getTime()).toBeGreaterThan(before[1].derivedAt.getTime());
    // 11 Aug in Berlin touches 10 and 11 Aug UTC; 9 Aug UTC (part of 10 Aug local) is untouched.
    const dirty = await prisma.travTrackDirtyDay.findMany({
      where: { userId },
      orderBy: { day: "asc" },
    });
    expect(dirty.map((d) => [d.day.toISOString().slice(0, 10), d.done])).toEqual([
      ["2026-08-09", 31],
      ["2026-08-10", SOURCES_BIT],
      ["2026-08-11", SOURCES_BIT],
    ]);
    // Back to automatic: the phone again.
    const reset = await setDaySourceChoice(userId, "2026-08-11", { overrideSource: null });
    expect(reset.segments.map((s) => s.source)).toEqual([PHONE]);
  });

  it("refuses a source that holds nothing on the day, and a day without points", async () => {
    await walk(userId, PHONE, D10 + 8 * H, D10 + 9 * H, 5);
    await expect(
      setDaySourceChoice(userId, "2026-08-10", { overrideSource: GOOGLE })
    ).rejects.toMatchObject({ statusCode: 400, code: "TRAVTRACK_SOURCE_NOT_ON_DAY" });
    await expect(
      setDaySourceChoice(userId, "2026-08-12", { outlierDecision: "discard" })
    ).rejects.toMatchObject({ statusCode: 404, code: "TRAVTRACK_DAY_NO_POINTS" });
  });
});
