import { describe, expect, it } from "vitest";
import { rowsFrom, toImportInput } from "../railImportModel";
import type { RailImportBooking, RailImportLeg } from "../../../types/rail";

/**
 * The train and bus segments of a FLIGHT booking (owner ruling 2026-11-05)
 * start ticked as what they are, and are no Rail&Fly ticket to the server.
 */
const station = (name: string) => ({
  name,
  printedName: name,
  stationId: null,
  code: null,
  lat: 50.9,
  lon: 7,
  country: "DE",
  timezone: "Europe/Berlin",
  resolved: true,
  positionSource: "catalogue" as const,
  catalogueConflictKm: null,
});

const leg = (mode: "rail" | "bus"): RailImportLeg => ({
  depStationName: "QKL",
  arrStationName: "FRA",
  departureLocal: "2026-09-10T06:12",
  arrivalLocal: "2026-09-10T07:20",
  trainCategory: null,
  trainNumber: "LH8878",
  coach: null,
  seat: null,
  direction: null,
  departureStation: station("Koeln Hbf"),
  arrivalStation: station("Frankfurt Flughafen"),
  duplicateOf: null,
  possibleDuplicateOf: null,
  transit: { mode, busKind: mode === "bus" ? "coach" : null },
});

const booking = (source: string, legs: RailImportLeg[]): RailImportBooking => ({
  bookingReference: "ABC123",
  travelClass: null,
  tariff: null,
  price: null,
  currency: null,
  operator: "Deutsche Bahn",
  source,
  legs,
});

describe("a flight booking's ground segments in the rail review", () => {
  it("ticks a bus leg of a flight booking as a bus ride, where a bahn.de bus leg starts unticked", () => {
    const defaults = { localTransit: "skip", bus: "skip", busEnabled: true } as const;
    expect(rowsFrom(booking("flight-booking", [leg("bus")]), defaults)[0]).toMatchObject({
      selected: true,
      saveAs: "bus",
    });
    expect(rowsFrom(booking("db-share-link", [leg("bus")]), defaults)[0]).toMatchObject({
      selected: false,
    });
  });

  it("ticks the train leg as a rail ride and never offers a bus leg without the bus domain", () => {
    const defaults = { localTransit: "skip", bus: "skip", busEnabled: false } as const;
    const rows = rowsFrom(booking("flight-booking", [leg("rail"), leg("bus")]), defaults);
    expect(rows[0]).toMatchObject({ selected: true, saveAs: "rail" });
    expect(rows[1]).toMatchObject({ selected: false, saveAs: null });
  });

  it("tells the server not to tie the train leg to a flight as Rail&Fly", () => {
    const b = booking("flight-booking", [leg("rail")]);
    const [row] = rowsFrom(b);
    expect(toImportInput(b, row, false).railAndFly).toBe(false);
    const ticket = booking("db-online-ticket", [leg("rail")]);
    expect(toImportInput(ticket, rowsFrom(ticket)[0], false).railAndFly).toBeUndefined();
  });
});
