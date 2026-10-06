import type {
  RailImportBooking,
  RailImportLeg,
  RailReservationMatch,
  RailReservationTarget,
} from "../../../types/rail";
import { leg, station } from "./railImportFixture";

/** Invented journeys and seats — the shape a reservation parse answers with (forgejo#203). */
export function target(over: Partial<RailReservationTarget> = {}): RailReservationTarget {
  return {
    id: "journey-1",
    trainCategory: "ICE",
    trainNumber: "615",
    depStationName: "Musterstadt Hbf",
    arrStationName: "Beispielburg Hbf",
    departureLocal: "2026-04-19T19:55",
    arrivalLocal: "2026-04-19T23:58",
    coach: null,
    seat: null,
    ...over,
  };
}

export function reservationLeg(
  reservation: RailReservationMatch,
  over: Partial<RailImportLeg> = {}
): RailImportLeg {
  return leg({
    depStationName: "Musterstadt Hbf",
    arrStationName: "Beispielburg Hbf",
    departureLocal: "2026-04-19T19:55",
    arrivalLocal: "2026-04-19T23:58",
    trainCategory: "ICE",
    trainNumber: "615",
    coach: "12",
    seat: "133",
    departureStation: station("Musterstadt Hbf", true, 4),
    arrivalStation: station("Beispielburg Hbf", true, 5),
    reservation,
    ...over,
  });
}

export function reservationBooking(legs: RailImportLeg[]): RailImportBooking {
  return {
    bookingReference: "310987654321",
    travelClass: "second",
    tariff: null,
    price: null,
    currency: null,
    operator: "Deutsche Bahn",
    source: "db-reservation",
    documentKind: "reservation",
    legs,
  };
}
