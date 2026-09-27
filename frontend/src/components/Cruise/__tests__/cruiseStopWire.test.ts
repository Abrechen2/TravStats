import { describe, expect, it } from "vitest";
import { cruiseStopToWire } from "../cruiseStopWire";
import { MissingZoneError } from "../../../lib/api/timeInput";
import type { CruiseStopInput, Port } from "../../../types";

const port = (timezone: string | null): Port => ({
  id: 42,
  name: "Bergen",
  city: "Bergen",
  country: "NO",
  unlocode: "NOBGO",
  lat: 60.39,
  lon: 5.32,
  timezone,
  region: null,
  isUserAdded: false,
});

const stop = (patch: Partial<CruiseStopInput>): CruiseStopInput => ({
  portId: 42,
  dayNumber: 2,
  isAtSea: false,
  date: "2027-06-02T00:00:00.000Z",
  arrivalTime: "2027-06-02T08:00:00.000Z",
  departureTime: "2027-06-02T17:30:00.000Z",
  ...patch,
});

describe("cruiseStopToWire — a port call in the time model's write shape", () => {
  it("a port that carries its zone sends {local, zone}; the day is a bare date", () => {
    const wire = cruiseStopToWire(stop({ port: port("Europe/Oslo") }), 0);
    expect(wire.date).toBe("2027-06-02");
    expect(wire.arrivalTime).toEqual({ local: "2027-06-02T08:00", zone: "Europe/Oslo" });
    expect(wire.departureTime).toEqual({ local: "2027-06-02T17:30", zone: "Europe/Oslo" });
    expect(wire).not.toHaveProperty("port");
  });

  it("a port without a zone is sent as a reference the server resolves", () => {
    const wire = cruiseStopToWire(stop({ port: port(null) }), 0);
    expect(wire.arrivalTime).toEqual({
      local: "2027-06-02T08:00",
      placeRef: { kind: "port", id: "42" },
    });
  });

  it("a time on a stop with no port is refused, never written as UTC", () => {
    expect(() => cruiseStopToWire(stop({ portId: null, unresolvedPortName: "Flåm" }), 3)).toThrow(
      MissingZoneError
    );
  });

  it("a stop without times sends none, and cleared times go as null", () => {
    const wire = cruiseStopToWire(
      stop({ portId: null, isAtSea: true, arrivalTime: null, departureTime: undefined }),
      1
    );
    expect(wire.arrivalTime).toBeNull();
    expect(wire).not.toHaveProperty("departureTime");
  });
});
