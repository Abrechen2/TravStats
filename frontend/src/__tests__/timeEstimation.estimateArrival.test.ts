import { describe, expect, it } from "vitest";
import { estimateArrivalFromDeparture } from "../lib/timeEstimation";

// Representative airport coordinates + IANA timezones.
const MUC = { lat: 48.3537, lon: 11.775, tz: "Europe/Berlin" };
const FRA = { lat: 50.0379, lon: 8.5622, tz: "Europe/Berlin" };
const AUH = { lat: 24.433, lon: 54.6511, tz: "Asia/Dubai" }; // UTC+4, no DST
const JFK = { lat: 40.6413, lon: -73.7781, tz: "America/New_York" }; // UTC-5/-4
const HND = { lat: 35.5494, lon: 139.7798, tz: "Asia/Tokyo" }; // UTC+9

describe("estimateArrivalFromDeparture", () => {
  it("short flight within the same timezone stays same-day", () => {
    const result = estimateArrivalFromDeparture({
      departureDate: "2026-06-15",
      departureTime: "08:00",
      departureLat: MUC.lat,
      departureLon: MUC.lon,
      departureTimezone: MUC.tz,
      arrivalLat: FRA.lat,
      arrivalLon: FRA.lon,
      arrivalTimezone: FRA.tz,
    });
    expect(result.arrivalDate).toBe("2026-06-15");
    expect(result.dayOffset).toBe(0);
    expect(result.tzAware).toBe(true);
    expect(result.durationMinutes).toBeGreaterThan(0);
    expect(result.durationMinutes).toBeLessThan(120);
  });

  it("long-haul east crossing a timezone reports arrival local time", () => {
    // MUC -> AUH in June: +2h TZ difference (CEST vs AST).
    // ~6h flight time, depart 09:00 MUC -> ~15:00 MUC -> ~17:00 AUH local.
    const result = estimateArrivalFromDeparture({
      departureDate: "2026-06-15",
      departureTime: "09:00",
      departureLat: MUC.lat,
      departureLon: MUC.lon,
      departureTimezone: MUC.tz,
      arrivalLat: AUH.lat,
      arrivalLon: AUH.lon,
      arrivalTimezone: AUH.tz,
    });
    expect(result.tzAware).toBe(true);
    expect(result.arrivalDate).toBe("2026-06-15");
    expect(result.dayOffset).toBe(0);
    const [h] = result.arrivalTime.split(":").map(Number);
    expect(h).toBeGreaterThanOrEqual(15);
    expect(h).toBeLessThanOrEqual(18);
  });

  it("overnight flight crossing midnight rolls the date forward", () => {
    // JFK -> MUC: ~8h flight, depart 22:00 NY local -> arrive next day in MUC.
    const result = estimateArrivalFromDeparture({
      departureDate: "2026-06-15",
      departureTime: "22:00",
      departureLat: JFK.lat,
      departureLon: JFK.lon,
      departureTimezone: JFK.tz,
      arrivalLat: MUC.lat,
      arrivalLon: MUC.lon,
      arrivalTimezone: MUC.tz,
    });
    expect(result.tzAware).toBe(true);
    expect(result.dayOffset).toBeGreaterThanOrEqual(1);
    expect(result.arrivalDate > "2026-06-15").toBe(true);
  });

  it("falls back to naive math when either timezone is missing", () => {
    const result = estimateArrivalFromDeparture({
      departureDate: "2026-06-15",
      departureTime: "10:00",
      departureLat: MUC.lat,
      departureLon: MUC.lon,
      departureTimezone: null,
      arrivalLat: AUH.lat,
      arrivalLon: AUH.lon,
      arrivalTimezone: AUH.tz,
    });
    expect(result.tzAware).toBe(false);
    // Naive path: add duration to 10:00 and see where we land.
    expect(result.arrivalTime).toMatch(/^\d{2}:\d{2}$/);
  });

  it("extreme long-haul preserves non-negative dayOffset", () => {
    // Any actual commercial route stays within one day when TZ-correcting,
    // so dayOffset must be >= 0 even if the wall clock appears to jump back.
    const result = estimateArrivalFromDeparture({
      departureDate: "2026-06-15",
      departureTime: "12:00",
      departureLat: HND.lat,
      departureLon: HND.lon,
      departureTimezone: HND.tz,
      arrivalLat: JFK.lat,
      arrivalLon: JFK.lon,
      arrivalTimezone: JFK.tz,
    });
    expect(result.dayOffset).toBeGreaterThanOrEqual(0);
    expect(result.arrivalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
