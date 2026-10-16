import { describe, it, expect } from "vitest";

import { railDayKeys, railYear } from "../railCounting";
import { busDayKeys, busYear } from "../busCounting";
import { ferryDayKeys, ferryYear } from "../ferryCounting";

/**
 * A zone this browser's Intl does not know (a misspelt one, or an IANA zone
 * newer than the runtime's data) made `new Intl.DateTimeFormat` throw a
 * RangeError, and the whole statistics page with it. The day keys now read
 * such a ride in UTC — the reading the server stores for a station it could
 * not place in a zone — instead of crashing.
 */
const ride = {
  departureTime: "2025-03-01T23:30:00.000Z",
  arrivalTime: "2025-03-02T01:00:00.000Z",
  depTimezone: "Not/AZone",
  arrTimezone: "Not/AZone",
};

describe("transport day keys with a zone the runtime does not know", () => {
  it("rail reads the ride in UTC instead of throwing", () => {
    expect(railDayKeys(ride)).toEqual(["2025-03-01", "2025-03-02"]);
    expect(railYear(ride)).toBe(2025);
  });

  it("bus reads the ride in UTC instead of throwing", () => {
    expect(busDayKeys(ride)).toEqual(["2025-03-01", "2025-03-02"]);
    expect(busYear(ride)).toBe(2025);
  });

  it("ferry reads the ride in UTC instead of throwing", () => {
    expect(ferryDayKeys(ride)).toEqual(["2025-03-01", "2025-03-02"]);
    expect(ferryYear(ride)).toBe(2025);
  });

  it("still reads a known zone on its own clock", () => {
    expect(railDayKeys({ ...ride, depTimezone: "Europe/Berlin", arrTimezone: null })).toEqual([
      "2025-03-02",
    ]);
  });
});
