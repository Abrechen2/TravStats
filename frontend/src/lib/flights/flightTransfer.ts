import { flightArrival, flightDeparture } from "../entityTimes";
import {
  SEPARATE_JOURNEY_AFTER_MINUTES,
  sameAirport,
  segmentTransfer,
  segmentTransfers,
  signedGapMinutes,
  transferAirport,
  transferAirportRef,
  type AirportVerdict,
  type FlightTransfer,
  type ResolvedTransferSegment,
} from "../../shared/flightTransfer";
import type { Flight } from "../../types";

/**
 * What lies between two consecutive flight segments of a booking
 * (forgejo#218), for a FLIGHT ROW. The rule itself — the wait, the order, the
 * airport, "another journey" — lives in `shared/flightTransfer.ts`, mirrored
 * on the server, which counts transfers with it for the statistics
 * (forgejo#256). This file only reads a flight's two ends as `TimeValue`s
 * (`entityTimes`) and its airports as references, and hands them over.
 */

export type TransferSegment = Pick<
  Flight,
  | "depIata"
  | "depIcao"
  | "arrIata"
  | "arrIcao"
  | "depLat"
  | "depLon"
  | "arrLat"
  | "arrLon"
  | "departureTime"
  | "arrivalTime"
> &
  Partial<
    Pick<Flight, "depTimezone" | "arrTimezone" | "depTimeSemantics" | "arrTimeSemantics" | "times">
  >;

export { SEPARATE_JOURNEY_AFTER_MINUTES, sameAirport, transferAirport };
export type { AirportVerdict, FlightTransfer };

function resolved(segment: TransferSegment): ResolvedTransferSegment {
  return {
    departure: flightDeparture(segment),
    arrival: flightArrival(segment),
    from: transferAirportRef(segment.depIata, segment.depIcao, segment.depLat, segment.depLon),
    to: transferAirportRef(segment.arrIata, segment.arrIcao, segment.arrLat, segment.arrLon),
  };
}

/** Minutes from the previous landing to the next take-off, signed; null when not both known to the minute. */
export function signedTransferMinutes(
  previous: TransferSegment,
  next: TransferSegment
): number | null {
  return signedGapMinutes(resolved(previous), resolved(next));
}

/** The verdict for one pair of consecutive segments whose ORDER is known. */
export function flightTransfer(previous: TransferSegment, next: TransferSegment): FlightTransfer {
  return segmentTransfer(resolved(previous), resolved(next));
}

/**
 * The verdict between every two consecutive segments, in the order given
 * (stored departure order): entry `i` is the gap after `segments[i]`.
 */
export function flightTransfers(segments: readonly TransferSegment[]): FlightTransfer[] {
  return segmentTransfers(segments.map(resolved));
}
