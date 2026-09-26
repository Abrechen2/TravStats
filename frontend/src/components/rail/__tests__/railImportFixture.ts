import type { RailImportBooking, RailImportLeg, RailImportStation } from "../../../types/rail";

/** Invented stations and values — the shape the rail parse route answers with. */
export function station(name: string, resolved = true, id = 1): RailImportStation {
  return resolved
    ? {
        name,
        printedName: name,
        stationId: id,
        code: `80${id}`,
        lat: 54 - id / 10,
        lon: 10,
        country: "DE",
        timezone: "Europe/Berlin",
        resolved: true,
      }
    : {
        name,
        printedName: name,
        stationId: null,
        code: null,
        lat: null,
        lon: null,
        country: null,
        timezone: null,
        resolved: false,
      };
}

export function leg(over: Partial<RailImportLeg> = {}): RailImportLeg {
  return {
    depStationName: "Kiel Hbf",
    arrStationName: "Hamburg Hbf",
    departureLocal: "2026-03-14T08:05",
    arrivalLocal: "2026-03-14T09:17",
    trainCategory: "RE",
    trainNumber: "7",
    coach: null,
    seat: null,
    direction: "outbound",
    departureStation: station("Kiel Hbf", true, 1),
    arrivalStation: station("Hamburg Hbf", true, 2),
    duplicateOf: null,
    ...over,
  };
}

export function booking(over: Partial<RailImportBooking> = {}): RailImportBooking {
  return {
    bookingReference: "210987654321",
    travelClass: "first",
    tariff: "Flexpreis",
    price: 1084.5,
    currency: "EUR",
    operator: null,
    source: "db-confirmation",
    legs: [
      leg(),
      leg({
        depStationName: "Hamburg Hbf",
        arrStationName: "Bremen Hbf",
        departureLocal: "2026-03-14T09:46",
        arrivalLocal: "2026-03-14T10:43",
        trainCategory: "ICE",
        trainNumber: "1507",
        coach: "7",
        seat: "45",
        departureStation: station("Hamburg Hbf", true, 2),
        arrivalStation: station("Bremen Hbf", true, 3),
      }),
    ],
    ...over,
  };
}
