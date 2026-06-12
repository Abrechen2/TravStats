import { describe, expect, it } from "vitest";
import {
  buildEffectiveTimeline,
  countUniquePorts,
} from "../../../components/Cruise/cruisePorts";
import type { Cruise, CruiseStop, Port } from "../../../types";

const port = (id: number, name: string): Port => ({
  id,
  name,
  city: null,
  country: null,
  unlocode: null,
  lat: 0,
  lon: 0,
  timezone: null,
  region: null,
  isUserAdded: false,
});

const stop = (id: string, p: Port | null, isAtSea: boolean, dayNumber: number): CruiseStop => ({
  id,
  cruiseId: "c1",
  portId: p?.id ?? null,
  port: p,
  dayNumber,
  isAtSea,
  arrivalTime: null,
  departureTime: null,
  excursionNote: null,
});

const baseCruise = (overrides: Partial<Cruise>): Cruise =>
  ({
    id: "c1",
    userId: "u1",
    shipId: null,
    ship: null,
    shipNameOverride: null,
    cruiseLine: null,
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: "2025-08-10T16:00:00.000Z",
    endDate: "2025-08-17T06:00:00.000Z",
    status: "scheduled",
    cabinNumber: null,
    cabinType: null,
    deck: null,
    bookingReference: null,
    price: null,
    currency: null,
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    stops: [],
    ...overrides,
  }) as Cruise;

const HAMBURG = port(1, "Hamburg");
const SOUTHAMPTON = port(2, "Southampton");
const LISBON = port(3, "Lisbon");

describe("countUniquePorts", () => {
  it("counts departure + arrival + port-call stops, de-duplicated", () => {
    const cruise = baseCruise({
      departurePort: HAMBURG,
      arrivalPort: LISBON,
      stops: [stop("s1", SOUTHAMPTON, false, 1), stop("s2", null, true, 2)],
    });
    expect(countUniquePorts(cruise)).toBe(3);
  });

  it("counts a round trip with the same departure/arrival port once", () => {
    const cruise = baseCruise({ departurePort: HAMBURG, arrivalPort: HAMBURG });
    expect(countUniquePorts(cruise)).toBe(1);
  });
});

describe("buildEffectiveTimeline", () => {
  it("wraps stops with departure and arrival entries", () => {
    const cruise = baseCruise({
      departurePort: HAMBURG,
      arrivalPort: LISBON,
      stops: [stop("s1", null, true, 1), stop("s2", SOUTHAMPTON, false, 2)],
    });
    const timeline = buildEffectiveTimeline(cruise);
    expect(timeline.map((e) => e.port?.name ?? "sea")).toEqual([
      "Hamburg",
      "sea",
      "Southampton",
      "Lisbon",
    ]);
    expect(timeline[0].date).toBe(cruise.startDate);
    expect(timeline[timeline.length - 1].date).toBe(cruise.endDate);
  });

  it("skips departure/arrival entries that duplicate the first/last port call", () => {
    const cruise = baseCruise({
      departurePort: HAMBURG,
      arrivalPort: LISBON,
      stops: [stop("s1", HAMBURG, false, 1), stop("s2", LISBON, false, 2)],
    });
    const timeline = buildEffectiveTimeline(cruise);
    expect(timeline).toHaveLength(2);
  });

  it("produces departure + arrival for a cruise without stops", () => {
    const cruise = baseCruise({ departurePort: HAMBURG, arrivalPort: LISBON });
    const timeline = buildEffectiveTimeline(cruise);
    expect(timeline.map((e) => e.port?.name)).toEqual(["Hamburg", "Lisbon"]);
  });
});
