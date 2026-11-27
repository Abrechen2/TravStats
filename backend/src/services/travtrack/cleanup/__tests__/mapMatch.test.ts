import type { StoredPoint } from "../../../tripRecording/segments";
import { MapMatchError, matchPiece, parseMatch, pointsToSend } from "../mapMatch";

/** Map matching (rc46 extras C2): what may leave, how an answer is read, the egress rules. */

const MIN = 60_000;
const p = (min: number, lat: number, lon: number): StoredPoint => [min * MIN, lat, lon, 20];
const road = [p(0, 48.0, 7.8), p(1, 48.001, 7.801), p(2, 48.002, 7.802), p(3, 48.003, 7.803)];

/** Google's encoded polyline, precision 6. */
function encode(points: [number, number][]): string {
  let out = "";
  let pLat = 0;
  let pLon = 0;
  const one = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const [lon, lat] of points) {
    const la = Math.round(lat * 1e6);
    const lo = Math.round(lon * 1e6);
    one(la - pLat);
    one(lo - pLon);
    pLat = la;
    pLon = lo;
  }
  return out;
}

const answer = (status: number, body: unknown) =>
  jest.fn(async () => new Response(JSON.stringify(body), { status }));

describe("pointsToSend — privacy zones before anything leaves", () => {
  it("cuts every fix inside a zone and splits the stretch there", () => {
    const zone = { lat: 48.0015, lon: 7.8015, radiusM: 80 };
    const stretch = [...road, p(4, 48.004, 7.804), p(5, 48.005, 7.805)];
    const pieces = pointsToSend(stretch, [zone]);
    const sent = pieces.flat();
    expect(sent.some((q) => q[1] === 48.001 || q[1] === 48.002)).toBe(false);
    expect(pieces.every((piece) => piece.length >= 3)).toBe(true);
  });

  it("sends nothing of a stretch with too few fixes left", () => {
    expect(pointsToSend(road.slice(0, 2), [])).toEqual([]);
  });
});

describe("parseMatch", () => {
  it("reads Valhalla's polyline6 shape and confidence score", () => {
    const m = parseMatch("valhalla", {
      shape: encode([
        [7.8, 48.0],
        [7.803, 48.003],
      ]),
      confidence_score: 0.92,
    });
    expect(m.confidence).toBe(0.92);
    expect(m.coordinates[1][0]).toBeCloseTo(7.803, 6);
    expect(m.coordinates[1][1]).toBeCloseTo(48.003, 6);
  });

  it("derives GraphHopper's confidence from matched against recorded length", () => {
    const m = parseMatch("graphhopper", {
      paths: [
        {
          points: {
            coordinates: [
              [7.8, 48],
              [7.81, 48.01],
            ],
          },
        },
      ],
      map_matching: { distance: 800, original_distance: 1000 },
    });
    expect(m.confidence).toBeCloseTo(0.8);
  });

  it("refuses an answer of another shape as itself", () => {
    expect(() => parseMatch("valhalla", { trip: {} })).toThrow(MapMatchError);
  });
});

describe("matchPiece — guarded egress", () => {
  it("posts only the piece's points, never following a redirect", async () => {
    const fetchImpl = answer(200, {
      shape: encode([
        [7.8, 48],
        [7.803, 48.003],
      ]),
      confidence_score: 0.9,
    });
    await matchPiece("valhalla", "http://192.168.1.5:8002", road, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://192.168.1.5:8002/trace_attributes");
    expect(init.redirect).toBe("manual");
    expect(JSON.parse(String(init.body)).shape).toHaveLength(road.length);
  });

  it("a redirect is not followed and reads as a bad response", async () => {
    await expect(
      matchPiece("valhalla", "http://router.lan", road, answer(302, {}))
    ).rejects.toMatchObject({ reason: "badResponse" });
  });

  it("an address that is not http(s) is refused before any request", async () => {
    const fetchImpl = answer(200, {});
    await expect(matchPiece("valhalla", "file:///etc", road, fetchImpl)).rejects.toMatchObject({
      reason: "invalidUrl",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a router that never answers is unreachable, not an empty match", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(matchPiece("graphhopper", "http://gh.lan", road, fetchImpl)).rejects.toMatchObject(
      { reason: "unreachable" }
    );
  });
});
