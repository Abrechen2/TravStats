import { prisma } from "../../../db";
import { travtrackProvider } from "../travtrackProvider";
import { makeUser, wipeTravTrack } from "../../travtrack/__tests__/fixtures";

/**
 * TravTrack as a `LocationProvider` (TravTrack plan T4, ported from the
 * archived internal reader): a half-open window, ascending by (t, seq), with
 * a cursor instead of a silently dropped oldest slice.
 */

const PREFIX = "travtrack-provider-";
const BASE = Date.parse("2026-10-12T00:00:00Z");

describe("travtrackProvider", () => {
  let userId: string;

  const point = (minute: number, device = "phone-1") =>
    prisma.travTrackPoint.create({
      data: {
        userId,
        t: new Date(BASE + minute * 60_000),
        tS: (BASE + minute * 60_000) / 1000,
        lat: 37 + minute / 1000,
        lon: 127,
        accuracyM: 5,
        origin: `companion:${device}`,
        originRef: `r${minute}`,
        deviceId: device,
      },
    });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await wipeTravTrack([userId]);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("answers a window ascending with string refs, half-open", async () => {
    for (const m of [30, 0, 10, 60]) await point(m);
    const result = await travtrackProvider(userId).readPoints({
      fromMs: BASE,
      untilMs: BASE + 60 * 60_000,
    });
    expect(result.coverage).toBe("complete");
    expect(result.next).toBeNull();
    expect(result.points.map((p) => p.atMs)).toEqual([
      BASE,
      BASE + 10 * 60_000,
      BASE + 30 * 60_000,
    ]);
    expect(result.points.every((p) => typeof p.ref === "string" && /^\d+$/.test(p.ref))).toBe(true);
    expect(result.points[0]).toMatchObject({ accuracyM: 5, deviceId: "phone-1", lon: 127 });
  });

  it("pages with a cursor instead of dropping the oldest", async () => {
    for (let m = 0; m < 5; m++) await point(m);
    const provider = travtrackProvider(userId, 2);
    const window = { fromMs: BASE, untilMs: BASE + 3_600_000 };
    const seen: number[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await provider.readPoints(window, cursor);
      seen.push(...page.points.map((p) => p.atMs));
      cursor = page.next ?? undefined;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual([0, 1, 2, 3, 4].map((m) => BASE + m * 60_000));
  });

  it("names deleted spans and reported gaps inside the window in its coverage", async () => {
    await point(5);
    await prisma.travTrackDeletedRange.create({
      data: { userId, fromAt: new Date(BASE + 600_000), toAt: new Date(BASE + 1_200_000) },
    });
    await prisma.travTrackGap.create({
      data: {
        userId,
        deviceId: "phone-1",
        fromAt: new Date(BASE + 1_800_000),
        toAt: new Date(BASE + 2_400_000),
        reason: "recorderSilent",
      },
    });
    const coverage = await travtrackProvider(userId).getCoverage({
      fromMs: BASE,
      untilMs: BASE + 3_600_000,
    });
    expect(coverage).toEqual({
      coverage: "complete",
      pointCount: 1,
      gaps: [
        { fromMs: BASE + 600_000, untilMs: BASE + 1_200_000, reason: "deleted" },
        { fromMs: BASE + 1_800_000, untilMs: BASE + 2_400_000, reason: "reported" },
      ],
    });
  });
});
