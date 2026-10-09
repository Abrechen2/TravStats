import type { RentalBooking } from "../../types/rental";

/**
 * What the return card shows (forgejo#240) — ALWAYS the return station's own
 * facts. A one-way rental goes back somewhere else than it came from, so a
 * missing return position or note is said as missing; nothing here ever
 * borrows the pickup station's position, name or zone to fill a gap.
 */
export interface RentalReturnFacts {
  station: string;
  iata: string | null;
  address: string | null;
  /** Null when the return station has no usable position — then no navigation link. */
  position: { lat: number; lon: number } | null;
  /** A directions link to the RETURN station; null without a position. */
  navigationUrl: string | null;
  fuelPolicy: RentalBooking["fuelPolicy"];
  notes: string | null;
  oneWay: boolean;
}

const usable = (lat: number | null | undefined, lon: number | null | undefined): boolean =>
  typeof lat === "number" &&
  typeof lon === "number" &&
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lon) <= 180 &&
  // 0/0 is the review's placeholder for "placed by airport", not a place.
  !(lat === 0 && lon === 0);

/**
 * A universal directions link: it opens the maps app on a tablet or phone
 * and a web map elsewhere, with the destination given as coordinates so no
 * search can land on a namesake.
 */
export function directionsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

export function rentalReturnFacts(
  rental: Pick<
    RentalBooking,
    | "returnStationName"
    | "returnIata"
    | "returnAddress"
    | "returnLat"
    | "returnLon"
    | "fuelPolicy"
    | "notes"
    | "oneWay"
  >
): RentalReturnFacts {
  const placed = usable(rental.returnLat, rental.returnLon);
  const position = placed ? { lat: rental.returnLat, lon: rental.returnLon } : null;
  return {
    station: rental.returnStationName,
    iata: rental.returnIata,
    address: rental.returnAddress,
    position,
    navigationUrl: position ? directionsUrl(position.lat, position.lon) : null,
    fuelPolicy: rental.fuelPolicy,
    notes: rental.notes?.trim() ? rental.notes.trim() : null,
    oneWay: rental.oneWay,
  };
}

/** The card belongs to a rental whose car is still to be returned. */
export function showsReturnCard(rental: Pick<RentalBooking, "status">): boolean {
  return rental.status === "scheduled" || rental.status === "in_progress";
}
