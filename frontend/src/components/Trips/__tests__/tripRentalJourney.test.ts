import { describe, expect, it } from "vitest";
import { journeyFromRental } from "../../map/cards/journeys/journeyNormalize";
import type { TripRental } from "../../../types/rental";

/**
 * Codex review before 2.7.0-beta.23: the trip map feeds its rentals into the
 * dashboard's own card normalizer, but `GET /trips/:id` sent only the branches
 * and times — a returned rental's card on the trip map printed no car, no
 * driven km and no cost, while the same rental's card on the dashboard did.
 * The row below is a trip response's rental, field for field as
 * `TRIP_RENTAL_SELECT` + `withTripDetailTimes` send it (the backend test
 * `trips.mapTransport.test.ts` pins that the server sends these fields).
 */
const tripRow: TripRental = {
  id: "r1",
  provider: "Testcar",
  operatedBy: "Counterco",
  pickupStationName: "Oslo Lufthavn",
  returnStationName: "Oslo Lufthavn",
  pickupTime: "2027-08-16T09:00:00.000Z",
  returnTime: "2027-08-18T09:00:00.000Z",
  pickupTimezone: "Europe/Oslo",
  returnTimezone: "Europe/Oslo",
  pickupPrecision: "minute",
  returnPrecision: "minute",
  status: "completed",
  pickupLat: 60.19,
  pickupLon: 11.1,
  returnLat: 60.19,
  returnLon: 11.1,
  oneWay: false,
  routeId: null,
  pickupIata: "OSL",
  returnIata: "OSL",
  pickupCountry: "NO",
  returnCountry: "NO",
  vehicleClass: "Compact",
  vehicleExample: "VW Golf",
  odometerOutKm: 1000,
  odometerInKm: 1420,
  distanceKm: 420,
  distanceSource: "invoice",
  price: 199,
  currency: "EUR",
  finalAmount: 231.5,
  finalCurrency: "EUR",
};

describe("a trip response's rental through the map card normalizer", () => {
  it("prints the car, the driven km, the cost and the branches' codes", () => {
    const j = journeyFromRental(tripRow as unknown as Parameters<typeof journeyFromRental>[0]);
    expect(j.facts.vehicleModel).toBe("VW Golf");
    expect(j.facts.cost).toEqual({ amount: 231.5, currency: "EUR" });
    expect(j.distanceKm).toBe(420);
    expect(j.distanceSource).toBe("invoice");
    expect(j.operator).toBe("Counterco");
    expect(j.dep).toMatchObject({ code: "OSL", country: "NO" });
    expect(j.arr).toMatchObject({ code: "OSL", country: "NO" });
  });
});
