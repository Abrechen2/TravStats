import type { Prisma, RentalBooking } from "../../../prisma";
import { pickFacts } from "./pick";

/**
 * A rental's facts: who hands over the keys, both stations, the times as
 * stored (ADR 0002), the car promised and the car driven, what the odometer
 * said, and the policies that came with the car. Private: confirmation,
 * broker, agreement and invoice numbers, price, final amount and every FX
 * column, inclusions bought, payment timing, the arriving flight (the
 * booker's own), notes, tags, companions, the hand-edit list and the
 * roadtrip link (a roadtrip is not copied in S1).
 */
export const RENTAL_FACT_FIELDS = [
  "provider",
  "operatedBy",
  "pickupStationName",
  "pickupAddress",
  "pickupAirportId",
  "pickupLat",
  "pickupLon",
  "pickupCountry",
  "pickupTimezone",
  "returnStationName",
  "returnAddress",
  "returnAirportId",
  "returnLat",
  "returnLon",
  "returnCountry",
  "returnTimezone",
  "pickupTime",
  "returnTime",
  "pickupPrecision",
  "returnPrecision",
  "actualPickupTime",
  "actualReturnTime",
  // An actual time travels with how much of it is known: without these, a
  // hand-over known only to the DAY reached the copy as a claimed 00:00
  // (`rentalTimes` reads a missing precision as minute) — forgejo#278.
  "actualPickupPrecision",
  "actualReturnPrecision",
  "vehicleClass",
  "acrissCode",
  "vehicleExample",
  "vehicleDriven",
  "licensePlate",
  "odometerOutKm",
  "odometerInKm",
  "distanceKm",
  "distanceSource",
  "mileagePolicy",
  "mileageCapKm",
  "fuelPolicy",
  "status",
] as const satisfies readonly (keyof RentalBooking)[];

export type RentalFactField = (typeof RENTAL_FACT_FIELDS)[number];

export function rentalFacts(row: Pick<RentalBooking, RentalFactField>) {
  return pickFacts(
    row,
    RENTAL_FACT_FIELDS
  ) satisfies Partial<Prisma.RentalBookingUncheckedCreateInput>;
}
