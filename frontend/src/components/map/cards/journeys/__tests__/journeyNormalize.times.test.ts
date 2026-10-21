import { describe, expect, it } from "vitest";
import { journeyFromBus, journeyFromFerry, journeyFromRail } from "../journeyNormalize";
import type { TimeValue } from "../../../../../shared/time";

/**
 * A journey's duration is measured only between two clocks. A ride logged
 * date-only is stored at the starts of its days, and subtracting those used to
 * print "Dauer 1 T 0 h" for a ferry nobody timed (the rule `railDurationMinutes`
 * keeps on the detail pages).
 */

function tv(local: string, utc: string, precision: TimeValue["precision"]): TimeValue {
  return { utc, zone: "Europe/Berlin", offset: "+02:00", local, precision };
}

const ENDS = {
  depStationName: "Kiel",
  depLat: 54.32,
  depLon: 10.14,
  arrStationName: "Oslo",
  arrLat: 59.9,
  arrLon: 10.75,
};

describe("journey durations", () => {
  it("measures two clocked ends", () => {
    const j = journeyFromFerry({
      id: "f1",
      status: "completed",
      ...ENDS,
      departureTime: "2024-08-10T12:00:00Z",
      arrivalTime: "2024-08-11T08:00:00Z",
      times: {
        departure: tv("2024-08-10T14:00:00", "2024-08-10T12:00:00Z", "minute"),
        arrival: tv("2024-08-11T10:00:00", "2024-08-11T08:00:00Z", "minute"),
        actualDeparture: null,
        actualArrival: null,
      },
    } as Parameters<typeof journeyFromFerry>[0]);
    expect(j.facts.durationMin).toBe(20 * 60);
  });

  it("abstains for a date-only ride instead of subtracting midnights", () => {
    const j = journeyFromFerry({
      id: "f2",
      status: "completed",
      ...ENDS,
      departureTime: "2024-08-09T22:00:00Z",
      arrivalTime: "2024-08-10T22:00:00Z",
      times: {
        departure: tv("2024-08-10T00:00:00", "2024-08-09T22:00:00Z", "day"),
        arrival: tv("2024-08-11T00:00:00", "2024-08-10T22:00:00Z", "day"),
        actualDeparture: null,
        actualArrival: null,
      },
    } as Parameters<typeof journeyFromFerry>[0]);
    expect(j.facts.durationMin).toBeNull();
  });

  it("abstains when the row carries no clocks at all (no `times`)", () => {
    const j = journeyFromBus({
      id: "b1",
      status: "completed",
      ...ENDS,
      departureTime: "2024-08-09T22:00:00Z",
      arrivalTime: "2024-08-10T22:00:00Z",
    } as Parameters<typeof journeyFromBus>[0]);
    expect(j.facts.durationMin).toBeNull();
  });

  it("keeps the arrival on its own clock, so an overnight crossing can name its second day", () => {
    const j = journeyFromRail({
      id: "r1",
      status: "completed",
      ...ENDS,
      departureTime: "2024-08-10T20:00:00Z",
      arrivalTime: "2024-08-11T06:00:00Z",
      times: {
        departure: tv("2024-08-10T22:00:00", "2024-08-10T20:00:00Z", "minute"),
        arrival: tv("2024-08-11T08:00:00", "2024-08-11T06:00:00Z", "minute"),
        actualDeparture: null,
        actualArrival: null,
      },
    } as Parameters<typeof journeyFromRail>[0]);
    expect(j.arrival?.local.slice(0, 10)).toBe("2024-08-11");
  });
});
