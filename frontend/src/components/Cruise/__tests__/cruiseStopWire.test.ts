import { describe, expect, it } from "vitest";
import { cruiseStopToWire, storedStopFold } from "../cruiseStopWire";
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

  it("a time on a stop with no port goes as a bare wall clock the server keeps unzoned, never as UTC", () => {
    const wire = cruiseStopToWire(stop({ portId: null, unresolvedPortName: "Flåm" }), 3);
    expect(wire.arrivalTime).toEqual({
      local: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    });
  });

  it("reads a stored later occurrence back from the instant, and nothing else", () => {
    expect(
      storedStopFold("2027-10-31T02:30:00.000Z", "2027-10-31T01:30:00.000Z", "Europe/Berlin")
    ).toBe("later");
    expect(
      storedStopFold("2027-10-31T02:30:00.000Z", "2027-10-31T00:30:00.000Z", "Europe/Berlin")
    ).toBeUndefined();
    expect(
      storedStopFold("2027-06-02T08:00:00.000Z", "2027-06-02T06:00:00.000Z", "Europe/Berlin")
    ).toBeUndefined();
    expect(storedStopFold("2027-10-31T02:30:00.000Z", null, "Europe/Berlin")).toBeUndefined();
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
