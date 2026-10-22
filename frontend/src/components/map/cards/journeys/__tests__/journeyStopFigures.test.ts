import { describe, expect, it } from "vitest";
import { journeyFromRail } from "../journeyNormalize";
import { endKey } from "../journeyStats";
import { getJourneyStopFigures } from "../journeyStopFigures";
import type { TimeValue } from "../../../../../shared/time";

/** A station card's own figures: departures, where they went, the last visit HERE. */

const BERLIN = { name: "Berlin Hbf", lat: 52.525, lon: 13.369 };
const HAMBURG = { name: "Hamburg Hbf", lat: 53.553, lon: 10.007 };
const MUNICH = { name: "München Hbf", lat: 48.14, lon: 11.558 };

function tv(local: string, utc: string): TimeValue {
  return { utc, zone: "Europe/Berlin", offset: "+02:00", local, precision: "minute" };
}

function ride(
  id: string,
  from: typeof BERLIN,
  to: typeof BERLIN,
  dep: string,
  arr: string | null,
  status = "completed"
) {
  return journeyFromRail({
    id,
    status,
    depStationName: from.name,
    depLat: from.lat,
    depLon: from.lon,
    arrStationName: to.name,
    arrLat: to.lat,
    arrLon: to.lon,
    departureTime: dep,
    times: {
      departure: tv(dep.slice(0, 19), dep),
      arrival: arr ? tv(arr.slice(0, 19), arr) : null,
      actualDeparture: null,
      actualArrival: null,
    },
  } as Parameters<typeof journeyFromRail>[0]);
}

describe("station figures", () => {
  const all = [
    ride("a", BERLIN, HAMBURG, "2024-01-01T08:00:00Z", "2024-01-01T10:00:00Z"),
    ride("b", BERLIN, HAMBURG, "2024-02-01T08:00:00Z", "2024-02-01T10:00:00Z"),
    ride("c", BERLIN, MUNICH, "2024-03-01T08:00:00Z", "2024-03-01T12:00:00Z"),
    ride("d", MUNICH, BERLIN, "2024-04-01T08:00:00Z", "2024-04-01T23:30:00Z"),
    ride("e", BERLIN, MUNICH, "2030-01-01T08:00:00Z", null, "scheduled"),
  ];
  const f = getJourneyStopFigures(all, endKey(BERLIN));

  it("counts departures and arrivals that happened, not the planned one", () => {
    expect(f.departures).toBe(3);
    expect(f.arrivals).toBe(1);
  });

  it("ranks the destinations from here", () => {
    expect(f.destinations).toEqual([
      { name: "Hamburg Hbf", count: 2 },
      { name: "München Hbf", count: 1 },
    ]);
  });

  it("dates the last visit by the arrival when the journey ended here", () => {
    expect(f.lastVisit?.utc).toBe("2024-04-01T23:30:00Z");
  });

  it("has nothing to say about a station nobody has left from yet", () => {
    const none = getJourneyStopFigures([all[4]], endKey(BERLIN));
    expect(none).toEqual({ departures: 0, arrivals: 0, destinations: [], lastVisit: null });
  });
});

describe("last visit at a branch a rental went back to", () => {
  it("is the return, not the pick-up, when the car came back here", async () => {
    const { journeyFromRental } = await import("../journeyNormalize");
    const round = journeyFromRental({
      id: "c",
      status: "completed",
      provider: "Sixt",
      pickupStationName: "Faro",
      returnStationName: "Faro",
      pickupLat: 37,
      pickupLon: -8,
      returnLat: 37,
      returnLon: -8,
      times: {
        pickup: tv("2024-10-01T10:00:00", "2024-10-01T09:00:00Z"),
        return: tv("2024-10-08T10:00:00", "2024-10-08T09:00:00Z"),
        actualPickup: null,
        actualReturn: null,
      },
    } as Parameters<typeof journeyFromRental>[0]);
    const f = getJourneyStopFigures([round], endKey({ lat: 37, lon: -8 }));
    expect(f.lastVisit?.utc).toBe("2024-10-08T09:00:00Z");
  });

  it("dates an unknown arrival by its departure's day, never its clock", () => {
    const f = getJourneyStopFigures(
      [ride("x", BERLIN, HAMBURG, "2024-06-01T08:00:00Z", null)],
      endKey(HAMBURG)
    );
    expect(f.arrivals).toBe(1);
    expect(f.lastVisit?.local.slice(0, 10)).toBe("2024-06-01");
    expect(f.lastVisit?.precision).toBe("day");
  });

  // beta.23 UAT before 2.7.0-rc.20: München Hbf said "Zuletzt hier 05.03.2024"
  // although a date-only ride Hamburg → München on 01.07.2025 (no arrival
  // recorded) had ended there since. The later journey was skipped, so an
  // older visit was named the last one.
  it("does not name an older visit the last when a later date-only ride ended here", () => {
    const dayOnly = journeyFromRail({
      id: "late",
      status: "completed",
      depStationName: HAMBURG.name,
      depLat: HAMBURG.lat,
      depLon: HAMBURG.lon,
      arrStationName: MUNICH.name,
      arrLat: MUNICH.lat,
      arrLon: MUNICH.lon,
      departureTime: "2025-06-30T22:00:00Z",
      times: {
        departure: {
          utc: "2025-06-30T22:00:00Z",
          zone: "Europe/Berlin",
          offset: "+02:00",
          local: "2025-07-01T00:00:00",
          precision: "day",
        },
        arrival: null,
        actualDeparture: null,
        actualArrival: null,
      },
    } as Parameters<typeof journeyFromRail>[0]);
    const f = getJourneyStopFigures(
      [
        ride("c", HAMBURG, MUNICH, "2024-03-01T07:01:00Z", "2024-03-01T12:58:00Z"),
        ride("d", MUNICH, HAMBURG, "2024-03-05T08:15:00Z", "2024-03-05T14:40:00Z"),
        dayOnly,
      ],
      endKey(MUNICH)
    );
    expect(f.lastVisit?.local.slice(0, 10)).toBe("2025-07-01");
    expect(f.lastVisit?.precision).toBe("day");
  });
});
