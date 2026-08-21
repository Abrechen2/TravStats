import { describe, expect, it } from "vitest";
import {
  buildEffectiveTimeline,
  countUniquePorts,
  countUnresolvedPorts,
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
  date: null,
  isAtSea,
  arrivalTime: null,
  departureTime: null,
  excursionNote: null,
  unresolvedPortName: null,
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

  it("prefers the explicit per-stop date over the arrival timestamp (#132)", () => {
    const cruise = baseCruise({
      stops: [
        { ...stop("s1", SOUTHAMPTON, false, 1), date: "2027-10-08T00:00:00.000Z" },
        { ...stop("s2", LISBON, false, 2), date: null, arrivalTime: "2027-10-09T08:00:00.000Z" },
      ],
    });
    const timeline = buildEffectiveTimeline(cruise);
    expect(timeline[0].date).toBe("2027-10-08T00:00:00.000Z");
    // Falls back to arrivalTime when date is absent (legacy stops).
    expect(timeline[1].date).toBe("2027-10-09T08:00:00.000Z");
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

describe("countUniquePorts with unresolved stops", () => {
  it("does NOT count unresolved stops as unique ports", () => {
    const cruise = baseCruise({
      departurePort: null,
      arrivalPort: null,
      stops: [
        stop("s1", port(1, "Kiel"), false, 1),
        { ...stop("s2", null, false, 2), unresolvedPortName: "Taranto" },
        { ...stop("s3", null, false, 3), unresolvedPortName: " taranto " },
        stop("s4", null, true, 4),
      ],
    });
    // Only Kiel is an identifiable port. The backend's `cruisePortsUnique`
    // counts the same way; before this change the frontend said 2.
    expect(countUniquePorts(cruise)).toBe(1);
  });

  it("reports unresolved stops separately, de-duplicated by trimmed name", () => {
    const cruise = baseCruise({
      departurePort: null,
      arrivalPort: null,
      stops: [
        stop("s1", port(1, "Kiel"), false, 1),
        { ...stop("s2", null, false, 2), unresolvedPortName: "Taranto" },
        { ...stop("s3", null, false, 3), unresolvedPortName: " taranto " },
        stop("s4", null, true, 4),
      ],
    });
    expect(countUnresolvedPorts(cruise)).toBe(1);
  });

  it("returns zero unresolved for a cruise with only matched ports", () => {
    const cruise = baseCruise({
      departurePort: HAMBURG,
      arrivalPort: LISBON,
      stops: [stop("s1", SOUTHAMPTON, false, 1)],
    });
    expect(countUnresolvedPorts(cruise)).toBe(0);
  });
});

describe("buildEffectiveTimeline carries unresolvedPortName", () => {
  it("exposes the unresolved name on the entry", () => {
    const cruise = baseCruise({
      departurePort: null,
      arrivalPort: null,
      stops: [{ ...stop("s1", null, false, 1), unresolvedPortName: "Taranto" }],
    });
    const entry = buildEffectiveTimeline(cruise).find((e) => e.unresolvedPortName);
    expect(entry?.unresolvedPortName).toBe("Taranto");
    expect(entry?.isAtSea).toBe(false);
  });
});
