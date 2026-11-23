import { prisma } from "../../../db";
import { travTrackDay } from "../dayView";
import { judgeSilence, type StationaryPlace } from "../silence/stationary";
import { makeUser, storePoint, wipeTravTrack } from "./fixtures";

/**
 * A quiet day at home sends no points (iOS suspends the app). When the last good fix before the
 * silence and the first one after it lie in the same known place, the day reads as that place —
 * inferred, never as recorded points. Anything else stays "no data" and says why.
 */

const PREFIX = "travtrack-stationary-";
const at = (iso: string) => Date.parse(iso);
const DAY = "2026-10-12"; // Berlin, UTC+2
const HOME = { lat: 47.8265, lon: 12.1902 };
// ~165 m west of HOME: the phone waking while the owner walks off, outside the 150 m circle.
const NEAR_HOME = { lat: 47.82656, lon: 12.18785 };
const ELSEWHERE = { lat: 48.137, lon: 11.575 };

describe("TravTrack — a silence spent standing at a known place", () => {
  let userId: string;

  const settings = async (home: boolean) => {
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.userSettings.create({
      data: {
        userId,
        enabledDomains: ["flight", "lodging"],
        data: {
          display: { timezone: "Europe/Berlin" },
          ...(home
            ? {
                homePeriods: [
                  {
                    fromDate: "2000-01-01",
                    toDate: null,
                    airports: [{ code: "MUC", primary: true }],
                    residence: { ...HOME, name: "Riedering" },
                    residenceConfirmed: true,
                  },
                ],
              }
            : {}),
        },
      },
    });
  };

  /** Quiet from the evening of 10 Oct to the morning of 14 Oct: the whole of DAY has no point. */
  const bracket = async (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
    await storePoint(userId, { t: at("2026-10-10T20:00:00Z"), ...a });
    await storePoint(userId, { t: at("2026-10-14T05:00:00Z"), ...b });
  };

  const day = () => travTrackDay(userId, DAY);

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });
  beforeEach(async () => {
    await wipeTravTrack([userId]);
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    await settings(true);
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("both ends inside home lead to inferred home presence for the whole silent day", async () => {
    await bracket(HOME, NEAR_HOME);
    const d = await day();
    expect(d.pointCount).toBe(0);
    expect(d.coverage).toHaveLength(1);
    expect(d.coverage[0]).toMatchObject({
      state: "stationary",
      place: { id: "home", kind: "home" },
    });
    expect(d.context).toContainEqual(
      expect.objectContaining({ kind: "stationary", id: "home", inferred: true })
    );
    expect(d.homeSuggestion).toBeNull();
  });

  it("ends at different places keep 'no location' and say why", async () => {
    await bracket(HOME, ELSEWHERE);
    const d = await day();
    expect(d.coverage).toEqual([
      expect.objectContaining({ state: "noData", why: "differentPlaces" }),
    ]);
    expect(d.context.some((c) => c.kind === "stationary")).toBe(false);
  });

  it("a flight inside the silence wins over standing still", async () => {
    await bracket(HOME, HOME);
    await prisma.flight.create({
      data: {
        userId,
        depIata: "MUC",
        arrIata: "LIS",
        depLat: 48.35,
        depLon: 11.78,
        arrLat: 38.77,
        arrLon: -9.13,
        flightNumber: "LH1",
        departureTime: new Date("2026-10-12T08:00:00Z"),
        arrivalTime: new Date("2026-10-12T11:00:00Z"),
        status: "flown",
      },
    });
    const d = await day();
    expect(d.coverage.map((c) => c.state)).toContain("entry");
    expect(d.coverage.some((c) => c.state === "stationary")).toBe(false);
    expect(d.coverage.find((c) => c.state === "noData")?.why).toBe("contradicted");
  });

  it("an accepted stay place counts too, with no home known", async () => {
    await settings(false);
    const place = await prisma.place.create({
      data: { userId, name: "Ferienhaus", lat: ELSEWHERE.lat, lon: ELSEWHERE.lon },
    });
    await bracket(ELSEWHERE, ELSEWHERE);
    const d = await day();
    expect(d.coverage[0]).toMatchObject({
      state: "stationary",
      place: { id: `place:${place.id}`, kind: "place", name: "Ferienhaus" },
    });
  });

  it("with no home known and both ends at one unknown spot, it offers that spot as home", async () => {
    await settings(false);
    await bracket(HOME, HOME);
    const d = await day();
    expect(d.coverage[0]).toMatchObject({ state: "noData", why: "outsidePlaces" });
    expect(d.homeSuggestion).toMatchObject({ lat: HOME.lat, lon: HOME.lon });
  });

  it("an isolated fix elsewhere inside the silence keeps it from being read as home", async () => {
    await bracket(HOME, HOME);
    await storePoint(userId, { t: at("2026-10-12T10:00:00Z"), ...ELSEWHERE });
    const d = await day();
    expect(d.coverage.every((c) => c.state !== "stationary")).toBe(true);
  });

  it("a point deleted on its own inside the silence is never bridged", async () => {
    await bracket(HOME, HOME);
    await prisma.travTrackDeletedPoint.create({
      data: { userId, digest: "d".repeat(64), tS: Math.floor(at("2026-10-12T10:00:00Z") / 1000) },
    });
    const d = await day();
    expect(d.coverage.every((c) => c.state !== "stationary")).toBe(true);
  });

  it("a silence still going on (no fix after it yet) is not explained", async () => {
    await storePoint(userId, { t: at("2026-10-10T20:00:00Z"), ...HOME });
    const d = await day();
    expect(d.coverage[0]).toMatchObject({ state: "noData", why: "openEnd" });
  });

  it("a privacy zone around home hides the ends: the silence is not explained", async () => {
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "home", lat: HOME.lat, lon: HOME.lon, radiusM: 300 },
    });
    await bracket(HOME, HOME);
    const d = await day();
    expect(d.coverage.every((c) => c.state !== "stationary")).toBe(true);
    expect(d.context.some((c) => c.kind === "stationary")).toBe(false);
  });
});

describe("judgeSilence", () => {
  const home: StationaryPlace = { id: "home", name: "Home", kind: "home", ...HOME, radiusM: 150 };
  const work: StationaryPlace = { id: "w", name: "Work", kind: "work", ...ELSEWHERE, radiusM: 100 };
  const end = (p: { lat: number; lon: number }) => ({ tMs: 0, ...p });

  it("names the place that holds both ends", () => {
    expect(judgeSilence(end(HOME), end(HOME), [work, home])).toEqual({
      kind: "stationary",
      place: home,
    });
  });
  it("separates different places from no place", () => {
    expect(judgeSilence(end(HOME), end(ELSEWHERE), [home, work])).toEqual({
      kind: "unexplained",
      reason: "differentPlaces",
    });
    expect(judgeSilence(end(ELSEWHERE), end(ELSEWHERE), [home])).toEqual({
      kind: "unexplained",
      reason: "outsidePlaces",
    });
  });
});
