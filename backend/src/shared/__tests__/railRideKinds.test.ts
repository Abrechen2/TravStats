import {
  categoryKey,
  isCrossBorderRide,
  isHighSpeedRide,
  isNightTrainRide,
  operatorKey,
  rideKm,
  type RailRideKindInput,
} from "../railRideKinds";

/** The kinds of ride the rail badges count — one truth table per question. */

const ride = (over: Partial<RailRideKindInput> = {}): RailRideKindInput => ({
  trainCategory: null,
  travelClass: null,
  depCountry: "DE",
  arrCountry: "DE",
  departureTime: new Date("2026-03-01T08:00:00Z"),
  arrivalTime: new Date("2026-03-01T12:00:00Z"),
  depDayKey: "2026-03-01",
  arrDayKey: "2026-03-01",
  ...over,
});

describe("railRideKinds", () => {
  it("reads a category by its first word, case-folded", () => {
    expect(categoryKey("TGV INOUI")).toBe("TGV");
    expect(categoryKey("  ice sprinter ")).toBe("ICE");
    expect(categoryKey("")).toBeNull();
    expect(categoryKey(null)).toBeNull();
  });

  it("calls a ride high-speed only when its category proves it", () => {
    expect(isHighSpeedRide({ trainCategory: "ICE" })).toBe(true);
    expect(isHighSpeedRide({ trainCategory: "Frecciarossa" })).toBe(false);
    expect(isHighSpeedRide({ trainCategory: "FR" })).toBe(true);
    expect(isHighSpeedRide({ trainCategory: "RE" })).toBe(false);
    expect(isHighSpeedRide({ trainCategory: null })).toBe(false);
  });

  it("knows a night train by its class, its category, or a long ride into the next day", () => {
    expect(isNightTrainRide(ride({ travelClass: "sleeper" }))).toBe(true);
    expect(isNightTrainRide(ride({ travelClass: "couchette" }))).toBe(true);
    expect(isNightTrainRide(ride({ trainCategory: "NJ" }))).toBe(true);
    // Vienna 22:58 → Hamburg 09:35 next day, no class recorded.
    expect(
      isNightTrainRide(
        ride({
          departureTime: new Date("2026-03-01T21:58:00Z"),
          arrivalTime: new Date("2026-03-02T08:35:00Z"),
          depDayKey: "2026-03-01",
          arrDayKey: "2026-03-02",
        })
      )
    ).toBe(true);
  });

  it("does not call a short ride across midnight a night train", () => {
    expect(
      isNightTrainRide(
        ride({
          departureTime: new Date("2026-03-01T22:40:00Z"),
          arrivalTime: new Date("2026-03-01T23:20:00Z"),
          depDayKey: "2026-03-01",
          arrDayKey: "2026-03-02",
        })
      )
    ).toBe(false);
  });

  it("does not invent a night from an unknown arrival", () => {
    expect(isNightTrainRide(ride({ arrivalTime: null, arrDayKey: null }))).toBe(false);
  });

  it("counts a border only between two KNOWN countries", () => {
    expect(isCrossBorderRide({ depCountry: "DE", arrCountry: "fr" })).toBe(true);
    expect(isCrossBorderRide({ depCountry: "DE", arrCountry: "de" })).toBe(false);
    expect(isCrossBorderRide({ depCountry: "DE", arrCountry: null })).toBe(false);
    expect(isCrossBorderRide({ depCountry: null, arrCountry: null })).toBe(false);
  });

  it("folds operator spelling so one company is one operator", () => {
    expect(operatorKey("DB  Fernverkehr ")).toBe(operatorKey("db fernverkehr"));
    expect(operatorKey("   ")).toBeNull();
    expect(operatorKey(null)).toBeNull();
  });

  it("counts every distance source, and a missing distance as none rather than zero", () => {
    expect(rideKm({ distanceKm: 420.5 })).toBe(420.5);
    expect(rideKm({ distanceKm: null })).toBeNull();
    expect(rideKm({ distanceKm: 0 })).toBeNull();
  });
});
