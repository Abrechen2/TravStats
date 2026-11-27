import type { Stop } from "../../legs/types";

/**
 * "Als Roadtrip übernehmen" names a station the way the day view names the stop
 * (rc46 retest: "Halt 1–6" in the preview, "Via Litoranea Nord" on the day).
 */

const MIN = 60_000;
const stop = (fromMin: number, untilMin: number, lat: number): Stop => ({
  fromMs: fromMin * MIN,
  untilMs: untilMin * MIN,
  anchor: { lat, lon: 8 },
  stayRef: null,
  place: null,
  folded: null,
});

const deriveDay = jest.fn();
jest.mock("../../dayDerivation", () => ({ deriveDay: (...a: unknown[]) => deriveDay(...a) }));
const stopIdentityFor = jest.fn();
jest.mock("../../stopPlaces/identity", () => ({
  stopIdentityFor: (...a: unknown[]) => stopIdentityFor(...a),
}));
jest.mock("../../../../shared/time/profileZone", () => ({
  profileZoneOf: async () => ({ zone: "UTC" }),
}));
jest.mock("../../../../db", () => ({
  prisma: {
    place: { findMany: async () => [] },
    dawarichStay: { findMany: async () => [] },
  },
}));

import { roadtripPreviewFor } from "../load";

const p = (min: number, lat: number) => [min * MIN, lat, 8, 10] as [number, number, number, number];
const drive1 = Array.from({ length: 31 }, (_, m) => p(m, 50 + m * 0.001));
const drive2 = Array.from({ length: 26 }, (_, m) => p(75 + m, 50.03 + m * 0.001));

describe("roadtrip preview station names", () => {
  beforeEach(() => {
    deriveDay.mockResolvedValue({
      raw: { next: null },
      read: { segments: [drive1, drive2] },
      stops: [stop(30, 75, 50.03)],
    });
    stopIdentityFor.mockReset();
  });

  it("a stop with no name takes the day view's suggestion for it", async () => {
    stopIdentityFor.mockResolvedValue({ probable: { name: "Via Litoranea Nord" } });
    const preview = await roadtripPreviewFor("u1", { fromMs: 0, untilMs: 200 * MIN }, 1);
    expect(preview.stations[1]).toMatchObject({
      name: "Via Litoranea Nord",
      nameSource: "suggestion",
    });
    expect(stopIdentityFor).toHaveBeenCalledTimes(1);
  });

  it("a failed lookup leaves the station unnamed instead of failing the preview", async () => {
    stopIdentityFor.mockRejectedValue(new Error("geocoder down"));
    const preview = await roadtripPreviewFor("u1", { fromMs: 0, untilMs: 200 * MIN }, 1);
    expect(preview.stations[1].name).toBeNull();
  });
});
