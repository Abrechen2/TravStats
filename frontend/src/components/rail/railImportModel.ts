import type {
  RailImportBooking,
  RailImportLeg,
  RailImportStation,
  RailJourneyInput,
  RailParseFallbackCode,
} from "../../types/rail";
import type { RailStationDraft } from "./RailStationField";

/**
 * The rail import review, as pure rules: which legs start ticked, when a leg
 * can be saved, and what each leg becomes as an ordinary POST /rail body — so
 * a parsed ride is a RailJourney like any other, counted, mapped and exported
 * without a special case.
 */

export interface RailImportRow {
  leg: RailImportLeg;
  /** Ticked for saving. A ride already in the logbook starts unticked. */
  selected: boolean;
  departure: RailStationDraft;
  arrival: RailStationDraft;
}

/** A resolved station arrives with its position; an unresolved one only with its name. */
export function stationDraftFrom(station: RailImportStation): RailStationDraft {
  return station.resolved
    ? {
        name: station.name,
        lat: station.lat,
        lon: station.lon,
        country: station.country,
        code: station.code,
        stationId: station.stationId,
      }
    : { name: station.name, lat: null, lon: null, country: null, code: null, stationId: null };
}

export function rowsFrom(booking: RailImportBooking): RailImportRow[] {
  return booking.legs.map((leg) => ({
    leg,
    selected: leg.duplicateOf === null,
    departure: stationDraftFrom(leg.departureStation),
    arrival: stationDraftFrom(leg.arrivalStation),
  }));
}

const placed = (s: RailStationDraft): boolean =>
  s.name.trim() !== "" && s.lat !== null && s.lon !== null;

/**
 * A leg can be saved once both stations have a position. Without one the
 * server could not know the station's clock, and a printed 09:38 would be
 * stored in some other zone — so the review asks for the station instead.
 */
export function isRowReady(row: RailImportRow): boolean {
  return placed(row.departure) && placed(row.arrival);
}

function stationInput(s: RailStationDraft): RailJourneyInput["departureStation"] {
  if (s.lat === null || s.lon === null) throw new Error("station without a position");
  return {
    stationId: s.stationId,
    name: s.name.trim(),
    code: s.code,
    lat: s.lat,
    lon: s.lon,
    country: s.country,
  };
}

/**
 * The booking's TOTAL goes on the first leg this import writes, and on no
 * other: a connection's legs share one ticket, and a price on every leg would
 * count it once per train. When a leg of the booking is already logged, the
 * total was likely recorded with it, so it is not written again.
 */
export function totalGoesTo(rows: readonly RailImportRow[]): number {
  if (rows.some((r) => r.leg.duplicateOf !== null)) return -1;
  return rows.findIndex((r) => r.selected);
}

export function toImportInput(
  booking: RailImportBooking,
  row: RailImportRow,
  carriesTotal: boolean
): RailJourneyInput {
  return {
    operator: booking.operator,
    trainCategory: row.leg.trainCategory,
    trainNumber: row.leg.trainNumber,
    departureStation: stationInput(row.departure),
    arrivalStation: stationInput(row.arrival),
    departureLocal: row.leg.departureLocal,
    arrivalLocal: row.leg.arrivalLocal,
    distanceKm: null,
    travelClass: booking.travelClass,
    coach: row.leg.coach,
    seat: row.leg.seat,
    delayMinutes: null,
    bookingReference: booking.bookingReference,
    price: carriesTotal ? booking.price : null,
    currency: booking.currency ?? "EUR",
    status: "scheduled",
    tags: [],
    companions: [],
    tripId: null,
    notes: booking.tariff,
    lookup: null,
  };
}

/** `2025-06-07T09:38` → `07.06.2025 09:38`, from the string — no clock involved. */
export function wallClockLabel(local: string | null): string {
  const m = local ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(local) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}` : "—";
}

/** The sentence for a parse that found no ride, keyed by the server's code. */
export function emptyParseMessageKey(code: RailParseFallbackCode | undefined): string {
  switch (code) {
    case "noItinerary":
      return "rail:import.empty.noItinerary";
    case "llmUnreachable":
      return "rail:import.empty.llmUnreachable";
    case "llmFailed":
      return "rail:import.empty.llmFailed";
    case "demoNoLlm":
      return "rail:import.empty.demoNoLlm";
    default:
      return "rail:import.empty.nothingFound";
  }
}
