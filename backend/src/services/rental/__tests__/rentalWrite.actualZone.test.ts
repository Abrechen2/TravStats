import { mergeRental, type RentalState } from "../rentalWrite";
import type { ResolvedStation } from "../rentalStations";

/**
 * A station moved into another zone keeps the wall clock the user entered —
 * for the actual hand-over as for the booked one. The actual end kept its UTC
 * instant, so 18:00 at the old station read as 12:00 at the new one.
 * Every value is invented.
 */

const berlin: ResolvedStation = {
  name: "Berlin Hbf",
  address: null,
  airportId: null,
  lat: 52.525,
  lon: 13.369,
  country: "DE",
  timezone: "Europe/Berlin",
};
const newYork: ResolvedStation = {
  ...berlin,
  name: "JFK",
  lat: 40.64,
  lon: -73.78,
  country: "US",
  timezone: "America/New_York",
};

const stored: RentalState = {
  pickupStationName: berlin.name,
  pickupAddress: null,
  pickupAirportId: null,
  pickupLat: berlin.lat,
  pickupLon: berlin.lon,
  pickupCountry: "DE",
  pickupTimezone: "Europe/Berlin",
  returnStationName: berlin.name,
  returnAddress: null,
  returnAirportId: null,
  returnLat: berlin.lat,
  returnLon: berlin.lon,
  returnCountry: "DE",
  returnTimezone: "Europe/Berlin",
  pickupTime: new Date("2026-05-01T08:00:00.000Z"), // 10:00 Berlin
  returnTime: new Date("2026-05-08T16:00:00.000Z"), // 18:00 Berlin
  pickupPrecision: "minute",
  returnPrecision: "minute",
  actualPickupTime: new Date("2026-05-01T08:15:00.000Z"),
  actualReturnTime: new Date("2026-05-08T16:30:00.000Z"), // 18:30 Berlin
  actualPickupPrecision: "minute",
  actualReturnPrecision: "minute",
  status: "completed",
};

describe("mergeRental: a station moved into another zone", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");

  it("keeps the actual return's wall clock, as it does the booked one", () => {
    const next = mergeRental(stored, {}, { return: newYork }, now);
    // 18:00 / 18:30 on the New York clock (EDT, UTC-4).
    expect(next.returnTime.toISOString()).toBe("2026-05-08T22:00:00.000Z");
    expect(next.actualReturnTime?.toISOString()).toBe("2026-05-08T22:30:00.000Z");
    expect(next.actualPickupTime?.toISOString()).toBe("2026-05-01T08:15:00.000Z");
  });

  it("keeps a day-only actual end on its day at the new station", () => {
    const dayOnly = {
      ...stored,
      actualReturnTime: new Date("2026-05-07T22:00:00.000Z"), // 8 May 00:00 Berlin
      actualReturnPrecision: "day",
    };
    const next = mergeRental(dayOnly, {}, { return: newYork }, now);
    expect(next.actualReturnTime?.toISOString()).toBe("2026-05-08T04:00:00.000Z");
    expect(next.actualReturnPrecision).toBe("day");
  });

  it("leaves the actual ends alone when the zone stays", () => {
    const next = mergeRental(stored, {}, { return: { ...berlin, name: "Berlin Ost" } }, now);
    expect(next.actualReturnTime).toEqual(stored.actualReturnTime);
  });
});
