import { acrissTraits } from "../../schemas/rental";
import { rentalCost, rentalDays } from "../../shared/rentalCounting";
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
  pickupAirport?: { iata: string | null } | null;
  returnAirport?: { iata: string | null } | null;
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
    times: rentalTimes(row),
  };
}
