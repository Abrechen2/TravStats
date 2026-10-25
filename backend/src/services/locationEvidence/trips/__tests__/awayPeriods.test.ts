import { prisma } from "../../../../db";
import { travTrackSwitches } from "../../../travtrack/__tests__/switches";
import {
  AWAY_KM,
  awayPeriods,
  awayRuns,
  classifyDays,
  dayRange,
  type AwayPoint,
  type HomeAt,
} from "../awayPeriods";
import {
  ABROAD,
  AWAY,
  HOME,
  HOME_PERIOD,
  makeTripUser,
  resetTripUser,
  setHomes,
  storeDay,
} from "./tripFixtures";

/**
 * Away periods (TravTrack plan L4): per local day of the home period's zone,
 * `away` when mostly more than 50 km from the confirmed residence, `home` when
 * mostly within, `unknown` without points — and an unknown day never joins two
 * runs nor counts as home (review focus 27).
 */

const H = 3_600_000;
const ZONE = "Europe/Berlin";
const homeAt: HomeAt = () => ({ ...HOME, zone: ZONE });

/** Fixes every hour on a Berlin day, 06:00–23:00 local, at `at`. */
function day(d: string, at: { lat: number; lon: number }, opts: { inFlight?: boolean } = {}) {
  const out: AwayPoint[] = [];
  const start = Date.parse(`${d}T04:00:00Z`);
  for (let t = start; t <= start + 17 * H; t += H) {
    out.push({ atMs: t, ...at, inFlight: opts.inFlight ?? false });
  }
  return out;
}

describe("classifyDays and awayRuns", () => {
  const days = dayRange("2026-10-10", "2026-10-16");

  it("three days > 50 km from the confirmed home are one away run", () => {
    const points = [
      ...day("2026-10-10", HOME),
      ...day("2026-10-11", AWAY),
      ...day("2026-10-12", AWAY),
      ...day("2026-10-13", ABROAD),
      ...day("2026-10-14", HOME),
      ...day("2026-10-15", HOME),
      ...day("2026-10-16", HOME),
    ];
    const classified = classifyDays(points, days, homeAt, {
      fallbackZone: ZONE,
      countryAt: (lat, lon) => (lon > 15 ? "AT" : lat > 40 ? "DE" : null),
    });
    expect(classified.map((d) => d.state)).toEqual([
      "home",
      "away",
      "away",
      "away",
      "home",
      "home",
      "home",
    ]);
    const runs = awayRuns(classified);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      fromDay: "2026-10-11",
      toDay: "2026-10-13",
      awayDays: ["2026-10-11", "2026-10-12", "2026-10-13"],
      countries: ["AT", "DE"],
      zone: ZONE,
    });
    expect(runs[0].km).toBeGreaterThan(AWAY_KM);
  });

  it("a day without points is unknown and splits nothing into home", () => {
    const points = [
      ...day("2026-10-10", HOME),
      ...day("2026-10-11", AWAY),
      ...day("2026-10-12", AWAY),
      // the 13th: nothing recorded
      ...day("2026-10-14", AWAY),
      ...day("2026-10-15", AWAY),
      ...day("2026-10-16", HOME),
    ];
    const classified = classifyDays(points, days, homeAt, { fallbackZone: ZONE });
    expect(classified[3]).toMatchObject({ day: "2026-10-13", state: "unknown", pointCount: 0 });
    // Two runs: the unknown day neither joins them nor reads as home.
    const runs = awayRuns(classified);
    expect(runs.map((r) => [r.fromDay, r.toDay])).toEqual([
      ["2026-10-11", "2026-10-12"],
      ["2026-10-14", "2026-10-15"],
    ]);
  });

  it("one away day is a run only with an away night", () => {
    const sameDay = [
      ...day("2026-10-10", HOME),
      // A day trip: away all day, home at night on both sides.
      ...day("2026-10-11", AWAY),
      ...day("2026-10-12", HOME),
    ];
    const short = dayRange("2026-10-10", "2026-10-12");
    expect(awayRuns(classifyDays(sameDay, short, homeAt, { fallbackZone: ZONE }))).toEqual([]);

    // Left on the evening of the 10th, back on the morning of the 12th: one
    // away day, two away nights — a trip over all three days.
    const tenth = day("2026-10-10", HOME);
    tenth.push({ atMs: Date.parse("2026-10-10T21:30:00Z"), ...AWAY, inFlight: false });
    const twelfth = day("2026-10-12", HOME);
    twelfth.unshift({ atMs: Date.parse("2026-10-11T22:30:00Z"), ...AWAY, inFlight: false });
    const night = [...tenth, ...day("2026-10-11", AWAY), ...twelfth];
    const runs = awayRuns(classifyDays(night, short, homeAt, { fallbackZone: ZONE }));
    expect(runs.map((r) => [r.fromDay, r.toDay, r.awayDays])).toEqual([
      ["2026-10-10", "2026-10-12", ["2026-10-11"]],
    ]);
  });

  it("points in the air count for nothing", () => {
    const points = [
      ...day("2026-10-10", HOME),
      ...day("2026-10-11", AWAY, { inFlight: true }),
      ...day("2026-10-12", AWAY, { inFlight: true }),
    ];
    const classified = classifyDays(points, dayRange("2026-10-10", "2026-10-12"), homeAt, {
      fallbackZone: ZONE,
    });
    expect(classified.map((d) => d.state)).toEqual(["home", "unknown", "unknown"]);
  });

  it("a day without a confirmed residence is unknown", () => {
    const points = [...day("2026-10-11", AWAY), ...day("2026-10-12", AWAY)];
    const classified = classifyDays(points, dayRange("2026-10-11", "2026-10-12"), () => null, {
      fallbackZone: ZONE,
    });
    expect(classified.map((d) => d.state)).toEqual(["unknown", "unknown"]);
    expect(awayRuns(classified)).toEqual([]);
  });

  it("a run at an edge of the read says so", () => {
    const points = [...day("2026-10-10", AWAY), ...day("2026-10-11", AWAY)];
    const [run] = awayRuns(
      classifyDays(points, dayRange("2026-10-10", "2026-10-12"), homeAt, { fallbackZone: ZONE })
    );
    expect(run).toMatchObject({ openStart: true, openEnd: false });
  });
});

describe("awayPeriods", () => {
  const switches = travTrackSwitches();
  const PREFIX = "trip-away-";
  let userId: string;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= "c".repeat(64);
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    userId = await makeTripUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await resetTripUser(userId);
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("reads stored history against the confirmed residence", async () => {
    await storeDay(userId, "2026-10-11", AWAY);
    await storeDay(userId, "2026-10-12", ABROAD);
    const read = await awayPeriods(userId, { fromDay: "2026-10-10", untilDay: "2026-10-13" });
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.coverage).toBe("complete");
    expect(read.days.map((d) => d.state)).toEqual(["unknown", "away", "away", "unknown"]);
    expect(read.runs).toHaveLength(1);
    expect(read.runs[0]).toMatchObject({ fromDay: "2026-10-11", toDay: "2026-10-12" });
    expect(read.runs[0].countries).toEqual(["AT", "DE"]);
  });

  it("no confirmed residence → nothing inferred", async () => {
    await storeDay(userId, "2026-10-11", AWAY);
    await storeDay(userId, "2026-10-12", AWAY);
    await setHomes(userId, [{ ...HOME_PERIOD, residenceConfirmed: false }]);
    expect(await awayPeriods(userId, { fromDay: "2026-10-10", untilDay: "2026-10-13" })).toEqual({
      status: "noResidence",
    });
  });
});
