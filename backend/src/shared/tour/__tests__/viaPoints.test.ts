import { foldViaPoints } from "../viaPoints";
import { countRoadtripNights, stationState } from "../roadtrip";

const stop = (id: string, lon: number, viaPoint = false) => ({ id, lat: 50, lon, viaPoint });
const leg = (from: string, to: string, km: number, minutes: number | null = 60) => ({
  id: `${from}-${to}`,
  fromStopId: from,
  toStopId: to,
  distanceKm: km,
  drivingMinutes: minutes,
  waypoints: null,
});

describe("route corrections (via points)", () => {
  it("is its own state, never a night", () => {
    expect(stationState({ lodgingStayId: null, overnight: false, viaPoint: true })).toBe("via");
    const nights = countRoadtripNights([
      {
        lodgingStayId: null,
        overnight: false,
        viaPoint: true,
        startDate: null,
        endDate: null,
        stay: null,
      },
    ]);
    expect(nights).toMatchObject({ nights: 0, placesSlept: 0, nightsKnown: true });
  });

  it("folds A → via → via → B into one leg A → B through both points", () => {
    const stops = [stop("a", 1), stop("v1", 2, true), stop("v2", 3, true), stop("b", 4)];
    const legs = [leg("a", "v1", 10, 10), leg("v1", "v2", 20, 20), leg("v2", "b", 30, 30)];
    const folded = foldViaPoints(stops, legs);
    expect(folded.stations.map((s) => s.id)).toEqual(["a", "b"]);
    expect(folded.legs).toHaveLength(1);
    expect(folded.legs[0]).toMatchObject({
      id: "a-v1",
      fromStopId: "a",
      toStopId: "b",
      distanceKm: 60,
      drivingMinutes: 60,
    });
    expect(folded.legs[0].waypoints).toEqual([
      [1, 50],
      [2, 50],
      [3, 50],
      [4, 50],
    ]);
  });

  it("says no driving time when a piece has none, rather than a partial sum", () => {
    const stops = [stop("a", 1), stop("v", 2, true), stop("b", 3)];
    const folded = foldViaPoints(stops, [leg("a", "v", 5, 10), leg("v", "b", 5, null)]);
    expect(folded.legs[0].drivingMinutes).toBeNull();
  });

  it("leaves a list without via points exactly as it was", () => {
    const stops = [stop("a", 1), stop("b", 2)];
    const legs = [leg("a", "b", 3)];
    expect(foldViaPoints(stops, legs)).toEqual({ stations: stops, legs });
  });

  it("drops a chain with a missing piece instead of inventing the leg", () => {
    const stops = [stop("a", 1), stop("v", 2, true), stop("b", 3)];
    expect(foldViaPoints(stops, [leg("a", "v", 5)]).legs).toEqual([]);
  });
});
