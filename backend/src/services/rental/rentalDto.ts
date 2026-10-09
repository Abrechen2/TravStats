import { acrissTraits } from "../../schemas/rental";
import { rentalCost, rentalDays, rentalDrivenKm } from "../../shared/rentalCounting";
import { isOneWay } from "./rentalWrite";
import { rentalTimes, type RentalTimeColumns } from "./timesDto";

/**
 * What a rental row carries beyond its columns when it is read: the D3
 * `times`, the derived one-way flag and rental days, the ACRISS traits
 * (derived, never stored — §3.1), the cost the statistics use and the two
 * airports' IATA codes, flattened. Nothing here is stored.
 */
export interface RentalReadColumns extends RentalTimeColumns {
  pickupAirportId: number | null;
  returnAirportId: number | null;
  pickupLat: number;
  pickupLon: number;
  returnLat: number;
  returnLon: number;
  acrissCode: string | null;
  price: number | null;
  currency: string | null;
  finalAmount: number | null;
  finalCurrency: string | null;
  status: string;
  distanceKm: number | null;
  distanceSource: string | null;
  odometerOutKm: number | null;
  odometerInKm: number | null;
  userEditedFields: string[];
  externalRef: string | null;
  pickupAirport?: { iata: string | null } | null;
  returnAirport?: { iata: string | null } | null;
}

/**
 * Where the BOOKED price came from (forgejo#237): the booking mail it was
 * imported from, unless a person typed or changed it since. The invoice never
 * writes the booked price, so the two amounts stay side by side with their
 * origins. Null without a price.
 */
export function rentalPriceSource(row: {
  price: number | null;
  userEditedFields: string[];
  externalRef: string | null;
}): "booking" | "user" | null {
  if (row.price === null) return null;
  if (row.userEditedFields.includes("price")) return "user";
  return row.externalRef ? "booking" : "user";
}

export function withRentalReadFields<T extends RentalReadColumns>(row: T) {
  const { pickupAirport, returnAirport, ...rest } = row;
  return {
    ...rest,
    pickupIata: pickupAirport?.iata ?? null,
    returnIata: returnAirport?.iata ?? null,
    oneWay: isOneWay(row),
    rentalDays: rentalDays(row),
    vehicleTraits: acrissTraits(row.acrissCode),
    cost: rentalCost(row),
    priceSource: rentalPriceSource(row),
    // Returned, and no driven km yet — not from an invoice, a correction or
    // both odometer readings (`rentalDrivenKm`, forgejo#206). The reminder the
    // Companion shows after a return (D11 b).
    invoiceMissing: row.status === "completed" && rentalDrivenKm(row) === null,
    times: rentalTimes(row),
  };
}
