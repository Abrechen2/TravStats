import { dawarichProvider } from "../dawarichProvider";

const getPoints = jest.fn();
jest.mock("../../dawarich/dawarichClient", () => ({
  createDawarichClient: () => ({ getPoints, checkHealth: jest.fn() }),
}));

/**
 * Dawarich as a `LocationProvider` (TravTrack plan T4): read-only, a
 * half-open request becomes Dawarich's inclusive window, a capped read says
 * truncated, and an unreachable Dawarich is an answer, never a throw into an
 * entry page.
 */

const CONNECTION = { baseUrl: "http://dawarich.local:3000", apiKey: "k", source: "user" } as never;
const FROM = Date.parse("2026-10-12T00:00:00Z");
const UNTIL = Date.parse("2026-10-13T00:00:00Z");
const remote = (tMs: number, id = tMs) => ({
  id,
  latitude: 60,
  longitude: 5,
  timestampMs: tMs,
  altitude: 10,
  accuracy: 8,
  velocity: 1.5,
  trackId: null,
});

describe("dawarichProvider", () => {
  beforeEach(() => getPoints.mockReset());

  it("an inclusive Dawarich window is read for a half-open request", async () => {
    getPoints.mockResolvedValue({ points: [remote(FROM), remote(UNTIL)], truncated: false });
    const result = await dawarichProvider(CONNECTION).readPoints({ fromMs: FROM, untilMs: UNTIL });
    expect(getPoints).toHaveBeenCalledWith({
      startAt: new Date(FROM),
      endAt: new Date(UNTIL - 1),
    });
    // Dawarich keys on whole seconds; a point at `until` is never inside.
    expect(result.points.map((p) => p.atMs)).toEqual([FROM]);
    expect(result.points[0]).toEqual({
      ref: String(FROM),
      atMs: FROM,
      lat: 60,
      lon: 5,
      accuracyM: 8,
      altitudeM: 10,
      speedMps: 1.5,
      courseDeg: null,
      deviceId: null,
    });
    expect(result).toMatchObject({ next: null, coverage: "complete" });
  });

  it("a truncated read says truncated and offers no cursor", async () => {
    getPoints.mockResolvedValue({ points: [remote(FROM + 1000)], truncated: true });
    expect(
      await dawarichProvider(CONNECTION).readPoints({ fromMs: FROM, untilMs: UNTIL })
    ).toMatchObject({ next: null, coverage: "truncated" });
  });

  it("an unreachable Dawarich answers unreachable, it does not throw", async () => {
    getPoints.mockRejectedValue(new Error("ECONNREFUSED"));
    const provider = dawarichProvider(CONNECTION);
    expect(await provider.readPoints({ fromMs: FROM, untilMs: UNTIL })).toEqual({
      points: [],
      next: null,
      coverage: "unreachable",
    });
    expect(await provider.getCoverage({ fromMs: FROM, untilMs: UNTIL })).toEqual({
      coverage: "unreachable",
      pointCount: null,
      gaps: [],
    });
  });
});
