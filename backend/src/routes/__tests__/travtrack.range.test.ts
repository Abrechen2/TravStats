import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { travTrackRange } from "../../services/travtrack/rangeView";
import { parseSafeCursor } from "../../services/travtrack/readSafe";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, storePoint, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";

/**
 * `GET /travtrack/range` (TravTrack plan T5.3): a span's privacy-safe
 * stretches for Monat / Jahr / Zeitraum, bounded, in parts, simplified — and
 * privacy-cut again AFTER simplifying, because a dropped vertex makes a chord
 * the raw points never had. A zone is never bridged; each vertex names its point.
 */

const PREFIX = "travtrack-range-";
const T = Date.parse("2026-10-10T12:00:00Z");
const MIN = 60_000;
const A = { lat: 37.5, lon: 127.0 };
const B = { lat: 37.53, lon: 127.01 }; // a detour 3 km north of the zone
const C = { lat: 37.5, lon: 127.02 };
const ZONE = { lat: 37.5, lon: 127.01, radiusM: 300 };

describe("TravTrack — range read", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let otherId: string;
  let cookie: string;

  const range = (query: Record<string, string>) =>
    request(app).get("/api/v1/travtrack/range").query(query).set("Cookie", cookie);
  const window = { fromMs: T - 60 * MIN, untilMs: T + 60 * MIN };

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    otherId = await makeUser(`${PREFIX}b`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId, otherId]);
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("answers the days' stretches with each vertex's point, and no other account's", async () => {
    const a = await storePoint(userId, { t: T, ...A });
    const b = await storePoint(userId, { t: T + 5 * MIN, ...B });
    await storePoint(otherId, { t: T + 2 * MIN, ...C });

    const res = await range({ fromDay: "2026-10-01", toDay: "2026-10-31" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      segments: [
        [
          [T, A.lat, A.lon, 5],
          [T + 5 * MIN, B.lat, B.lon, 5],
        ],
      ],
      pointIds: [[a, b]],
      pointCount: 2,
      simplified: false,
      omittedSegments: 0,
      next: null,
      cursor: null,
    });
  });

  it("never bridges a privacy zone: the stretches either side stay apart", async () => {
    await prisma.travTrackPrivacyZone.create({ data: { userId, name: "Zuhause", ...ZONE } });
    await storePoint(userId, { t: T, ...A });
    await storePoint(userId, { t: T + MIN, lat: A.lat, lon: A.lon - 0.001 });
    await storePoint(userId, { t: T + 5 * MIN, ...C });
    await storePoint(userId, { t: T + 6 * MIN, lat: C.lat, lon: C.lon + 0.001 });

    const res = await range({ fromDay: "2026-10-10", toDay: "2026-10-10" });

    expect(res.status).toBe(200);
    expect(res.body.segments).toHaveLength(2);
    for (const s of res.body.segments as number[][][]) {
      const lons = s.map((p) => p[2]);
      expect(lons.every((l) => l < ZONE.lon) || lons.every((l) => l > ZONE.lon)).toBe(true);
    }
  });

  describe("simplification is privacy-checked on its result", () => {
    beforeEach(async () => {
      await storePoint(userId, { t: T, ...A });
      await storePoint(userId, { t: T + 5 * MIN, ...B });
      await storePoint(userId, { t: T + 10 * MIN, ...C });
    });

    it("without a zone, the detour simplifies to its chord", async () => {
      const out = await travTrackRange(userId, window, null, { vertices: 2 });
      expect(out.simplified).toBe(true);
      expect(out.segments.map((s) => s.map((p) => p[0]))).toEqual([[T, T + 10 * MIN]]);
    });

    it("with a zone under that chord, the chord is cut, not drawn", async () => {
      await prisma.travTrackPrivacyZone.create({ data: { userId, name: "Zuhause", ...ZONE } });
      // The raw stretch passes the zone at 850 m: the read alone keeps it whole.
      expect((await travTrackRange(userId, window, null)).segments).toHaveLength(1);

      const out = await travTrackRange(userId, window, null, { vertices: 2 });

      const joined = out.segments.some(
        (s) => s.length >= 2 && s[0][0] === T && s[s.length - 1][0] === T + 10 * MIN
      );
      expect(joined).toBe(false);
      expect(out.pointIds.flat()).toHaveLength(out.pointCount);
    });
  });

  it("comes in parts: a cursor picks up where the part ended, each point once", async () => {
    const ids = [
      await storePoint(userId, { t: T, ...A }),
      await storePoint(userId, { t: T + MIN, ...B }),
      await storePoint(userId, { t: T + 2 * MIN, ...C }),
    ];
    const first = await travTrackRange(userId, window, null, { read: 2 });
    expect(first.next).not.toBeNull();
    expect(first.cursor).not.toBeNull();
    const second = await travTrackRange(userId, window, parseSafeCursor(first.cursor!), {
      read: 2,
    });
    expect(second.cursor).toBeNull();
    expect([...first.pointIds.flat(), ...second.pointIds.flat()]).toEqual(ids);
  });

  it("refuses a span over 400 days", async () => {
    const res = await range({ fromDay: "2025-01-01", toDay: "2026-02-10" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRAVTRACK_RANGE_TOO_LONG");
    expect((await range({ fromDay: "2026-10-10" })).status).toBe(400);
  });

  it("TravTrack off → 403 TRAVTRACK_DISABLED", async () => {
    await storePoint(userId, { t: T, ...A });
    await switches.set({ beta: true, config: false });
    const res = await range({ fromDay: "2026-10-10", toDay: "2026-10-10" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
  });
});
