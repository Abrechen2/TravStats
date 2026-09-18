import type { FlightTimeSemantics } from "../timezone";

// These two shapes are published by /stats/business and /stats/unique, so the
// schema in `schemas/statsFlights.ts` is where they are described and this is
// where that description is read (forgejo#52). One description, not two.
export type { BusinessStats, UniqueStats, FunStats } from "../../schemas/statsFlights";

export interface FlightData {
  id: string;
  /**
   * IANA timezone of the DEPARTURE airport, resolved by the caller from the
   * airport cache. Every figure about *when* a flight happened is read on
   * this clock rather than on the UTC instant (#266). Null/absent means no
   * timezone is on file and the stored components are used as-is.
   */
  depTimezone?: string | null;
  /** Storage semantics of `departureTime` — decides how its clock is read. */
  depTimeSemantics?: FlightTimeSemantics;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  depIata?: string | null;
  depIcao?: string | null;
  arrIata?: string | null;
  arrIcao?: string | null;
  airline?: string | null;
  aircraft?: string | null;
  departureTime: Date | null;
  arrivalTime: Date | null;
  status: string;
  price?: number | null;
  taxes?: number | null;
  fees?: number | null;
  currency?: string | null;
  /** Base-currency value snapshotted on write (#267). */
  priceBase?: number | null;
  /** Which base currency that snapshot is in. */
  fxBaseCurrency?: string | null;
  category?: string | null;
  seatClass?: string | null;
  createdAt: Date;
  bookingId?: string | null;
  booking?: {
    id: string;
    price?: number | null;
    currency?: string | null;
    priceBase?: number | null;
    fxBaseCurrency?: string | null;
  } | null;
}
