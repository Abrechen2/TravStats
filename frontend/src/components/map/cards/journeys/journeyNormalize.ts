// Each domain's row, read into the one shape the journey card speaks.
//
// The inputs are deliberately PARTIAL: the map layers are fed slim rows (the
// trip endpoint's `TripBusJourney`, a layer's `RailPathSource` pick), and a
// field a row does not carry is simply a fact the card does not print. What
// "travelled" means is never decided here — each domain's counting module is
// asked, so a card cannot count a ride the statistics page does not.

import { isCountableRail, isCountedRailMode } from "../../../../shared/railCounting";
import { isCountableBus } from "../../../../shared/busCounting";
import { isCountableFerry } from "../../../../shared/ferryCounting";
import {
  isCountableRental,
  rentalCost,
  rentalDays,
  rentalDrivenKm,
} from "../../../../shared/rentalCounting";
import { isCountableFlight } from "../../../../shared/flightCounting";
import { calculateDistance } from "../../../../lib/geo";
import { flightArrival, flightDeparture } from "../../../../lib/entityTimes";
import { railDurationMinutes } from "../../../../lib/railTime";
import { timeValueAtZone, type TimeValue } from "../../../../shared/time";
import type { Flight } from "../../../../types";
import type { RailJourney } from "../../../../types/rail";
import type { BusJourney } from "../../../../types/bus";
import type { FerryJourney } from "../../../../types/ferry";
import type { RentalBooking } from "../../../../types/rental";
import type { JourneyDomain, JourneyEnd, JourneyFacts, MapJourney } from "./journeyTypes";

/** Planned = still ahead: not travelled by the domain's rule, and not cancelled. */
function plannedOf(status: string, travelled: boolean): boolean {
  return !travelled && status !== "cancelled";
}

/**
 * Minutes between two clocked ends, or null. Only a value known to the minute
 * measures anything: a ride logged date-only is stored at the starts of its
 * days, and subtracting those invented "1 T 0 h" (the rule
 * `railDurationMinutes` keeps on the detail pages).
 */
export function timedMinutes(
  from: TimeValue | null | undefined,
  to: TimeValue | null | undefined
): number | null {
  if (!from || !to) return null;
  const minutes = railDurationMinutes(from, to);
  return minutes !== null && minutes > 0 ? minutes : null;
}

/**
 * A recorded distance, or null. A recorded 0 is a KNOWN 0, as every domain's
 * statistics read it (`measured = distanceKm !== null`); only null is unknown.
 */
function knownKm(km: number | null | undefined): number | null {
  return typeof km === "number" && Number.isFinite(km) && km >= 0 ? km : null;
}

/**
 * The fields `K` required, the rest optional. `status` is read as plain text:
 * the map layers carry it as `string`, and the counting modules take a string.
 */
type Partial2<T, K extends keyof T> = Omit<Pick<T, K>, "status"> & {
  status: string;
} & Partial<Omit<T, K | "status">>;

/** The station fields every terminal-ride domain shares. */
type TerminalCore = "id" | "status" | "depStationName" | "arrStationName" | "depLat" | "depLon";
type TerminalCoreEnd = "arrLat" | "arrLon";

function terminalEnds(
  j: Omit<Pick<RailJourney, TerminalCore | TerminalCoreEnd>, "status"> & {
    depCountry?: string | null;
    arrCountry?: string | null;
  },
  codes: { dep?: string | null; arr?: string | null } = {}
): { dep: JourneyEnd; arr: JourneyEnd } {
  return {
    dep: {
      name: j.depStationName,
      code: codes.dep ?? null,
      country: j.depCountry ?? null,
      lat: j.depLat,
      lon: j.depLon,
    },
    arr: {
      name: j.arrStationName,
      code: codes.arr ?? null,
      country: j.arrCountry ?? null,
      lat: j.arrLat,
      lon: j.arrLon,
    },
  };
}

/** A terminal ride's departure on its station's clock: the server's `times`, else the zone column. */
function stationDeparture(j: {
  departureTime?: string | null;
  depTimezone?: string | null;
  times?: { departure?: TimeValue | null };
}): TimeValue | null {
  return j.times?.departure ?? timeValueAtZone(j.departureTime, j.depTimezone);
}

/**
 * A terminal ride's arrival as the server sent it. No fallback to the legacy
 * column: without the server's precision a date-only arrival would read as a
 * clock at midnight.
 */
function stationArrival(j: { times?: { arrival?: TimeValue | null } }): TimeValue | null {
  return j.times?.arrival ?? null;
}

/** A terminal ride's departure, only as the server sent it — for measuring, not showing. */
function timedDeparture(j: { times?: { departure?: TimeValue | null } }): TimeValue | null {
  return j.times?.departure ?? null;
}

/**
 * A recorded delay that measures something: both ends clocked and an
 * arrival to be late against (`railStats.delayBuckets`), else null.
 */
function clockedDelay(j: {
  delayMinutes?: number | null;
  times?: { departure?: TimeValue | null; arrival?: TimeValue | null };
}): number | null {
  const delay = j.delayMinutes;
  if (typeof delay !== "number" || !Number.isFinite(delay)) return null;
  return timedMinutes(timedDeparture(j), stationArrival(j)) === null ? null : delay;
}

function journey(
  domain: JourneyDomain,
  base: { id: string; status: string },
  ends: { dep: JourneyEnd; arr: JourneyEnd },
  rest: {
    departureTime: string | null;
    departure: TimeValue | null;
    arrival: TimeValue | null;
    distanceKm: number | null;
    distanceSource: string | null;
    operator: string | null;
    travelled: boolean;
    facts: JourneyFacts;
  }
): MapJourney {
  return {
    id: base.id,
    domain,
    status: base.status,
    ...ends,
    ...rest,
    planned: plannedOf(base.status, rest.travelled),
  };
}

export function journeyFromRail(
  j: Partial2<RailJourney, TerminalCore | TerminalCoreEnd>
): MapJourney {
  const train = [j.trainCategory, j.trainNumber].filter(Boolean).join(" ");
  // A U-Bahn or tram ride is drawn but tallied neither as travelled nor as
  // planned: the card's figures are rail figures (`railCounting`). A row
  // without the field is from a server before it, where every ride was a train.
  const ride = { status: j.status, transitMode: j.transitMode ?? "rail" };
  const mapped = journey(
    "rail",
    j,
    terminalEnds(j, { dep: j.depStationCode, arr: j.arrStationCode }),
    {
      departureTime: j.departureTime ?? null,
      departure: stationDeparture(j),
      arrival: stationArrival(j),
      distanceKm: knownKm(j.distanceKm),
      distanceSource: knownKm(j.distanceKm) === null ? null : (j.distanceSource ?? null),
      operator: j.operator ?? null,
      travelled: isCountableRail(ride),
      facts: {
        trainNumber: train || null,
        trainCategory: j.trainCategory ?? null,
        travelClass: j.travelClass ?? null,
        seat: [j.coach, j.seat].filter(Boolean).join(" / ") || null,
        durationMin: timedMinutes(timedDeparture(j), stationArrival(j)),
        delayMinutes: clockedDelay(j),
      },
    }
  );
  return isCountedRailMode(ride) ? mapped : { ...mapped, planned: false };
}

export function journeyFromBus(
  j: Partial2<BusJourney, TerminalCore | TerminalCoreEnd>
): MapJourney {
  return journey("bus", j, terminalEnds(j), {
    departureTime: j.departureTime ?? null,
    departure: stationDeparture(j),
    arrival: stationArrival(j),
    distanceKm: knownKm(j.distanceKm),
    distanceSource: knownKm(j.distanceKm) === null ? null : (j.distanceSource ?? null),
    operator: j.operator ?? null,
    travelled: isCountableBus(j),
    facts: {
      lineName: j.lineName ?? null,
      seat: j.seat ?? null,
      durationMin: timedMinutes(timedDeparture(j), stationArrival(j)),
      delayMinutes: clockedDelay(j),
    },
  });
}

export function journeyFromFerry(
  j: Partial2<FerryJourney, TerminalCore | TerminalCoreEnd>
): MapJourney {
  return journey("ferry", j, terminalEnds(j), {
    departureTime: j.departureTime ?? null,
    departure: stationDeparture(j),
    arrival: stationArrival(j),
    distanceKm: knownKm(j.distanceKm),
    distanceSource: knownKm(j.distanceKm) === null ? null : (j.distanceSource ?? null),
    operator: j.operator ?? null,
    travelled: isCountableFerry(j),
    facts: {
      vesselName: j.vesselName ?? null,
      cabinType: j.cabinType ?? null,
      seat: j.seat ?? null,
      durationMin: timedMinutes(timedDeparture(j), stationArrival(j)),
      delayMinutes: clockedDelay(j),
    },
  });
}

/** A rental's cost in its own currency; a cancellation fee is not a rental's cost. */
function costOf(r: {
  status: string;
  price?: number | null;
  currency?: string | null;
  finalAmount?: number | null;
  finalCurrency?: string | null;
}): { amount: number; currency: string } | null {
  const cost = rentalCost({
    status: r.status,
    price: r.price ?? null,
    currency: r.currency ?? null,
    finalAmount: r.finalAmount ?? null,
    finalCurrency: r.finalCurrency ?? null,
  });
  return cost && cost.source !== "cancellationFee"
    ? { amount: cost.amount, currency: cost.currency }
    : null;
}

type RentalCore =
  | "id"
  | "status"
  | "provider"
  | "pickupStationName"
  | "returnStationName"
  | "pickupLat"
  | "pickupLon"
  | "returnLat"
  | "returnLon";

/**
 * A rental's "departure" is its pick-up. The pick-up instant lives in `times`
 * on the full row; a map row without it has no date to show rather than an
 * invented one.
 */
export function journeyFromRental(r: Partial2<RentalBooking, RentalCore>): MapJourney {
  const pickup = r.times?.pickup?.utc ?? null;
  const ret = r.times?.return?.utc ?? null;
  const days =
    pickup && ret && r.pickupTimezone && r.returnTimezone
      ? rentalDays({
          pickupTime: pickup,
          returnTime: ret,
          pickupTimezone: r.pickupTimezone,
          returnTimezone: r.returnTimezone,
        })
      : null;
  const driven = rentalDrivenKm({
    distanceKm: r.distanceKm ?? null,
    distanceSource: r.distanceSource ?? null,
    odometerOutKm: r.odometerOutKm ?? null,
    odometerInKm: r.odometerInKm ?? null,
  });
  return journey(
    "rental",
    { id: r.id, status: r.status },
    {
      dep: {
        name: r.pickupStationName,
        code: r.pickupIata ?? null,
        country: r.pickupCountry ?? null,
        lat: r.pickupLat,
        lon: r.pickupLon,
      },
      arr: {
        name: r.returnStationName,
        code: r.returnIata ?? null,
        country: r.returnCountry ?? null,
        lat: r.returnLat,
        lon: r.returnLon,
      },
    },
    {
      departureTime: pickup,
      departure: r.times?.pickup ?? null,
      arrival: r.times?.return ?? null,
      // The one driven-km rule the rental pages and statistics read: a stored
      // figure, else the two odometer readings (forgejo#206).
      distanceKm: driven?.km ?? null,
      distanceSource: driven?.source ?? null,
      operator: r.operatedBy ?? r.provider ?? null,
      travelled: isCountableRental(r),
      facts: {
        vehicleClass: r.vehicleExample ?? r.vehicleClass ?? null,
        vehicleModel: r.vehicleExample ?? null,
        rentalDays: days,
        cost: costOf(r),
      },
    }
  );
}

/** The slim flight a trip lists — `Trip.flights`. */
export interface TripFlightRow {
  id: string;
  depIata?: string | null;
  arrIata?: string | null;
  depLat?: number | null;
  depLon?: number | null;
  arrLat?: number | null;
  arrLon?: number | null;
  departureTime?: string | null;
  arrivalTime?: string | null;
  /** The departure airport's zone and how the time was recorded — the card shows ITS day. */
  depTimezone?: string | null;
  depTimeSemantics?: Flight["depTimeSemantics"];
  arrTimezone?: string | null;
  arrTimeSemantics?: Flight["arrTimeSemantics"];
  times?: Flight["times"];
  airline?: string | null;
  flightNumber?: string | null;
  status: string;
}

/**
 * A trip's flight. The trip endpoint sends no distance, so the great circle
 * between the two airports stands in — which is what a flight's distance IS
 * everywhere else in the app (`/geo` computes it the same way). Null when an
 * end has no coordinates.
 */
export function journeyFromTripFlight(f: TripFlightRow): MapJourney | null {
  const { depLat, depLon, arrLat, arrLon } = f;
  if (depLat == null || depLon == null || arrLat == null || arrLon == null) return null;
  const end = (code: string | null | undefined, lat: number, lon: number): JourneyEnd => ({
    name: code ?? "?",
    code: code ?? null,
    country: null,
    lat,
    lon,
  });
  return journey(
    "flight",
    f,
    { dep: end(f.depIata, depLat, depLon), arr: end(f.arrIata, arrLat, arrLon) },
    {
      departureTime: f.departureTime ?? null,
      departure: flightDeparture(f),
      arrival: flightArrival(f),
      distanceKm: knownKm(calculateDistance(depLat, depLon, arrLat, arrLon)),
      distanceSource: null,
      operator: f.airline ?? null,
      travelled: isCountableFlight({ status: f.status }),
      facts: {
        trainNumber: f.flightNumber ?? null,
        durationMin: timedMinutes(flightDeparture(f), flightArrival(f)),
      },
    }
  );
}
