import { observeQueries, prisma } from "../../../db";
import { FLIGHT_LINE_POINT_CAP, travTrackFlightLines } from "../flightLines";
import { makeFlight, makeUser, wipeTravTrack } from "./fixtures";
import { travTrackSwitches } from "./switches";

/**
 * The map's TravTrack flight lines are bounded per flight (final Codex review
 * before the RC): a dense recording is thinned in the database, so a map load
 * never reads a whole history — and the line still runs from the first fix to
 * the last.
 */

const PREFIX = "travtrack-flightlines-bounded-";
// The fixture flight: ICN 00:30Z → CJU 01:30Z on 12 Oct 2026.
const DEP = Date.parse("2026-10-12T00:30:00Z");

describe("travTrackFlightLines — bounded", () => {
  const switches = travTrackSwitches();
  let userId: string;

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    await switches.set({ beta: true, config: true });
  });

  afterAll(async () => {
    await wipeTravTrack([userId]);
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("reads at most the cap of a dense flight and keeps its first and last fix", async () => {
    const flightId = await makeFlight(userId);
    const n = FLIGHT_LINE_POINT_CAP + 500;
    const fix = (i: number) => {
      const t = DEP + Math.round((i * 3_600_000) / n);
      return {
        userId,
        t: new Date(t),
        tS: Math.floor(t / 1000),
        lat: 37.46 - (i * 3.95) / n,
        lon: 126.45 + (i * 0.04) / n,
        accuracyM: 5,
        origin: "companion:phone-1",
        originRef: `dense-${i}`,
        deviceId: "phone-1",
      };
    };
    await prisma.travTrackPoint.createMany({ data: Array.from({ length: n }, (_, i) => fix(i)) });

    let read = 0;
    const original = prisma.travTrackPoint.findMany.bind(prisma.travTrackPoint);
    const spy = jest.spyOn(prisma.travTrackPoint, "findMany").mockImplementation(((
      args: Parameters<typeof original>[0]
    ) =>
      original(args).then((rows) => {
        read += rows.length;
        return rows;
      })) as unknown as typeof prisma.travTrackPoint.findMany);
    try {
      const lines = await travTrackFlightLines(userId, () => []);
      const line = lines.find((l) => l.flightId === flightId);
      expect(line).toBeDefined();
      expect(read).toBeLessThanOrEqual(FLIGHT_LINE_POINT_CAP);
      const first = line!.geometry[0];
      const last = line!.geometry[line!.geometry.length - 1];
      expect(first[1]).toBeCloseTo(fix(0).lat, 4);
      expect(last[1]).toBeCloseTo(fix(n - 1).lat, 4);
    } finally {
      spy.mockRestore();
    }
  });

  it("runs no thinning query for flights outside the recorded extent that hold no link (forgejo#333)", async () => {
    const user = await makeUser(`${PREFIX}b`);
    try {
      // Five flights of 2020, a recording of October 2026 only.
      for (let i = 0; i < 5; i++) {
        await prisma.flight.create({
          data: {
            userId: user,
            depIata: "ICN",
            arrIata: "CJU",
            depLat: 37.469,
            depLon: 126.451,
            arrLat: 33.511,
            arrLon: 126.493,
            flightNumber: `KE${i}`,
            departureTime: new Date(Date.parse("2020-03-01T10:00:00Z") + i * 86_400_000),
            arrivalTime: new Date(Date.parse("2020-03-01T11:00:00Z") + i * 86_400_000),
            status: "flown",
          },
        });
      }
      const flightId = await makeFlight(user);
      await prisma.travTrackPoint.createMany({
        data: [0, 1, 2].map((i) => ({
          userId: user,
          t: new Date(DEP + i * 600_000),
          tS: Math.floor((DEP + i * 600_000) / 1000),
          lat: 37.4 - i * 0.5,
          lon: 126.4,
          accuracyM: 5,
          origin: "companion:phone-1",
          originRef: `ext-${i}`,
          deviceId: "phone-1",
        })),
      });
      let raw = 0;
      const stop = observeQueries(({ model, operation }) => {
        if (model === undefined && /queryRaw/i.test(operation)) raw++;
      });
      try {
        const lines = await travTrackFlightLines(user, () => []);
        expect(lines.map((l) => l.flightId)).toEqual([flightId]);
      } finally {
        stop();
      }
      // One thinning query for the one flight inside the extent, none for 2020.
      expect(raw).toBeLessThanOrEqual(1);
    } finally {
      await wipeTravTrack([user]);
    }
  });
});
