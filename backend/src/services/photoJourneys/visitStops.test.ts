import type { PhotoCluster } from "./cluster";
import { findVisitStops, type VisitStopFlight, type VisitStopPlace } from "./visitStops";

/**
 * Which stops inside a trip become a question (forgejo#211). The zone is
 * fixed to Seoul's by injection, so the days are the stop's own days and the
 * verdicts do not move with the test host's clock.
 */
const SEOUL = "Asia/Seoul";
const zoneAt = () => SEOUL;

const PALACE = { lat: 37.5796, lon: 126.977 };
/** ~100 m north of the palace. */
const NEAR = { lat: PALACE.lat + 0.0009, lon: PALACE.lon };
/** ~2 km away. */
const FAR = { lat: PALACE.lat + 0.018, lon: PALACE.lon };

// 14:10 to 15:00 on 1 May 2026, Seoul time — 05:10Z to 06:00Z.
const stop = (over: Partial<PhotoCluster> = {}): PhotoCluster => ({
  startMs: Date.UTC(2026, 4, 1, 5, 10),
  endMs: Date.UTC(2026, 4, 1, 6, 0),
  photoIds: ["a", "b", "c"],
  photoCount: 3,
  locatedCount: 3,
  position: PALACE,
  samples: [PALACE],
  ...over,
});

const trip = (id: string, from: string, to: string, name = id) => ({
  id,
  name,
  startDate: new Date(`${from}T00:00:00Z`),
  endDate: new Date(`${to}T00:00:00Z`),
});
const KOREA = trip("korea", "2026-04-28", "2026-05-06", "Korea");

const place = (over: Partial<VisitStopPlace> = {}): VisitStopPlace => ({
  id: "place-1",
  name: "Gyeongbokgung",
  localName: "경복궁",
  ...PALACE,
  visits: [],
  ...over,
});

const flight = (over: Partial<VisitStopFlight> = {}): VisitStopFlight => ({
  departureTime: null,
  arrivalTime: null,
  status: "flown",
  depLat: null,
  depLon: null,
  arrLat: null,
  arrLon: null,
  ...over,
});

const NOTHING = { trips: [KOREA], places: [], lodgings: [], flights: [] };

describe("which stops of a trip become a question", () => {
  it("asks about a stop inside a trip's days, anchored to that trip", () => {
    const stops = findVisitStops([stop()], NOTHING, zoneAt);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ tripId: "korea", zone: SEOUL, place: null });
  });

  it("asks nothing about a stop no trip's days hold", () => {
    const before = stop({
      startMs: Date.UTC(2026, 3, 20, 5, 0),
      endMs: Date.UTC(2026, 3, 20, 6, 0),
    });
    expect(findVisitStops([before], NOTHING, zoneAt)).toHaveLength(0);
  });

  it("reads the stop's days on ITS clock: a Seoul morning on the first day is in the trip", () => {
    // 08:00 Seoul on 28 April is 23:00Z on the 27th — before the trip's UTC
    // midnight, and inside the trip all the same.
    const morning = stop({
      startMs: Date.UTC(2026, 3, 27, 23, 0),
      endMs: Date.UTC(2026, 3, 27, 23, 30),
    });
    expect(findVisitStops([morning], NOTHING, zoneAt)).toHaveLength(1);
  });

  it("files the stop on the shortest trip whose days hold it", () => {
    const rows = { ...NOTHING, trips: [KOREA, trip("seoul", "2026-04-30", "2026-05-02", "Seoul")] };
    expect(findVisitStops([stop()], rows, zoneAt)[0].tripId).toBe("seoul");
  });

  it("drops a stop at an own place that has a visit that day", () => {
    const visited = place({ visits: [{ visitedAt: new Date("2026-05-01T00:00:00Z") }] });
    expect(findVisitStops([stop()], { ...NOTHING, places: [visited] }, zoneAt)).toHaveLength(0);
  });

  it("keeps a stop at an own place with no visit that day, and names the place for the accept", () => {
    const yesterday = place({ visits: [{ visitedAt: new Date("2026-04-30T00:00:00Z") }] });
    const stops = findVisitStops([stop()], { ...NOTHING, places: [yesterday] }, zoneAt);
    expect(stops).toHaveLength(1);
    expect(stops[0].place).toEqual({ id: "place-1", name: "Gyeongbokgung", localName: "경복궁" });
  });

  it("does not let an own place 2 km away explain anything", () => {
    const far = place({ ...FAR, visits: [{ visitedAt: new Date("2026-05-01T00:00:00Z") }] });
    const stops = findVisitStops([stop()], { ...NOTHING, places: [far] }, zoneAt);
    expect(stops).toHaveLength(1);
    expect(stops[0].place).toBeNull();
  });

  it("drops a stop at a lodging the user has a stay at — a lobby is not a sight", () => {
    expect(findVisitStops([stop()], { ...NOTHING, lodgings: [NEAR] }, zoneAt)).toHaveLength(0);
    expect(
      findVisitStops([stop()], { ...NOTHING, lodgings: [{ lat: null, lon: null }] }, zoneAt)
    ).toHaveLength(1);
  });

  it("drops a stop at an airport the user flew from that day, and only that day", () => {
    const sameDay = flight({
      departureTime: new Date("2026-05-01T09:00:00Z"),
      depLat: NEAR.lat,
      depLon: NEAR.lon,
    });
    const otherDay = flight({
      departureTime: new Date("2026-05-03T09:00:00Z"),
      depLat: NEAR.lat,
      depLon: NEAR.lon,
    });
    expect(findVisitStops([stop()], { ...NOTHING, flights: [sameDay] }, zoneAt)).toHaveLength(0);
    expect(findVisitStops([stop()], { ...NOTHING, flights: [otherDay] }, zoneAt)).toHaveLength(1);
  });

  it("explains nothing with a cancelled flight", () => {
    const cancelled = flight({
      status: "cancelled",
      arrivalTime: new Date("2026-05-01T09:00:00Z"),
      arrLat: NEAR.lat,
      arrLon: NEAR.lon,
    });
    expect(findVisitStops([stop()], { ...NOTHING, flights: [cancelled] }, zoneAt)).toHaveLength(1);
  });

  it("orders the questions biggest first", () => {
    const small = stop({ photoCount: 3 });
    const big = stop({
      photoCount: 40,
      startMs: Date.UTC(2026, 4, 2, 5, 0),
      endMs: Date.UTC(2026, 4, 2, 7, 0),
    });
    expect(findVisitStops([small, big], NOTHING, zoneAt).map((s) => s.cluster.photoCount)).toEqual([
      40, 3,
    ]);
  });
});
