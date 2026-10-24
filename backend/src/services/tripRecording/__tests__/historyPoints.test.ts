import { locationHistoryBatches } from "../historyPoints";
import type { RecordingTrip } from "../bounds";
import type {
  LocationObservation,
  LocationProvider,
  ReadResult,
} from "../../locationProvider/types";

/**
 * A trip's share of the location history through the `LocationProvider`
 * interface (TravTrack plan T4, rewritten from the archived
 * `historyPoints.dawarich.test.ts`).
 */

const FROM = Date.parse("2026-03-10T00:00:00Z");
const UNTIL = Date.parse("2026-03-12T00:00:00Z");
const FLIGHT: [number, number] = [FROM + 10 * 3_600_000, FROM + 12 * 3_600_000];

jest.mock("../bounds", () => ({
  ...jest.requireActual("../bounds"),
  tripRecordingBounds: async () => ({
    fromMs: FROM,
    untilMs: UNTIL,
    zone: "UTC",
    flightWindows: [FLIGHT],
  }),
}));

const trip = { id: "trip-1", name: "Bergen" } as unknown as RecordingTrip;
const obs = (
  ref: string,
  atMs: number,
  deviceId: string | null,
  lat = 60.39
): LocationObservation => ({
  ref,
  atMs,
  lat,
  lon: 5.32,
  accuracyM: 5,
  altitudeM: null,
  speedMps: null,
  courseDeg: null,
  deviceId,
});
const providerOf = (kind: "travtrack" | "dawarich", answer: ReadResult): LocationProvider => ({
  kind,
  readPoints: async () => answer,
  getCoverage: async () => ({ coverage: answer.coverage, pointCount: 0, gaps: [] }),
});
const pointsOf = (batch: { points: unknown }) => (batch.points as number[][]).map((p) => p[0]);

describe("a trip's history through its provider", () => {
  it("a trip reads its share of TravTrack points per device, minus the flight window", async () => {
    const provider = providerOf("travtrack", {
      points: [
        obs("1", FROM + 3_600_000, "phone-a"),
        obs("2", FROM + 3_600_000, "phone-b", 60.5),
        obs("3", FROM + 11 * 3_600_000, "phone-a"), // in flight
        obs("4", FROM + 20 * 3_600_000, "phone-a"),
      ],
      next: null,
      coverage: "complete",
    });
    const { batches, coverage } = await locationHistoryBatches("u", trip, provider);
    expect(coverage).toBe("complete");
    expect(
      batches
        .map((b) => [b.deviceId, pointsOf(b)])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    ).toEqual([
      ["phone-a", [FROM + 3_600_000, FROM + 20 * 3_600_000]],
      ["phone-b", [FROM + 3_600_000]],
    ]);
  });

  it("a Dawarich provider's points come back with coverage, truncated said as truncated", async () => {
    const provider = providerOf("dawarich", {
      points: [obs("9", FROM + 7_200_000, null)],
      next: null,
      coverage: "truncated",
    });
    const { batches, coverage } = await locationHistoryBatches("u", trip, provider);
    expect(coverage).toBe("truncated");
    expect(batches).toHaveLength(1);
    expect(batches[0].deviceId).toBeNull();
  });

  it("a point held both in a #316 batch and in TravTrack is shown once", async () => {
    const provider = providerOf("travtrack", {
      points: [obs("1", FROM + 3_600_000, "phone-a"), obs("2", FROM + 7_200_000, "phone-a")],
      next: null,
      coverage: "complete",
    });
    const legacy = [{ deviceId: "phone-a", points: [[FROM + 3_600_000, 60.39, 5.32, 5]] }];
    const { batches } = await locationHistoryBatches("u", trip, provider, { legacy });
    expect(batches.flatMap(pointsOf)).toEqual([FROM + 7_200_000]);
  });

  it("a linked fix is added once, even outside the trip's days, never inside a flight", async () => {
    const provider = providerOf("travtrack", {
      points: [obs("1", FROM + 3_600_000, "phone-a")],
      next: null,
      coverage: "complete",
    });
    const extra = [
      obs("1", FROM + 3_600_000, "phone-a"),
      obs("7", UNTIL + 3_600_000, "phone-a"),
      obs("8", FROM + 11 * 3_600_000, "phone-a"),
    ];
    const { batches } = await locationHistoryBatches("u", trip, provider, { extra });
    expect(batches.flatMap(pointsOf)).toEqual([FROM + 3_600_000, UNTIL + 3_600_000]);
  });

  it("no provider reads nothing", async () => {
    expect(await locationHistoryBatches("u", trip, null)).toEqual({ batches: [], coverage: null });
  });
});
