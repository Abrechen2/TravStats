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

/** Lower case, no diacritics, "ue" read as "ü", punctuation as a space — then words. */
function stationWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ae/g, "a")
    .replace(/oe/g, "o")
    .replace(/ue/g, "u")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** A cut-off word ("Flugh.") stands for a longer one — but not a stub of three letters. */
const MIN_PREFIX = 4;
const MIN_PREFIX_SHARE = 0.5;

function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return (
    long.startsWith(short) &&
    short.length >= MIN_PREFIX &&
    short.length / long.length >= MIN_PREFIX_SHARE
  );
}

/**
 * Whether a catalogue station is a plausible reading of the name a ticket
 * printed — the minimum similarity a SUGGESTION must meet (acceptance D1:
 * "MUC" was offered "Mücka", "FRA" "Frant", because the typeahead matches any
 * word start). Every printed word of two letters or more must meet a word of
 * the station, whole or as a real abbreviation; an airport code never does.
 * A miss leaves the station unresolved and the user searches — never a guess.
 */
export function isPlausibleStation(printedName: string, stationName: string): boolean {
  if (/^[A-Z]{3}$/.test(printedName.trim())) return false;
  const printed = stationWords(printedName).filter((w) => w.length >= 2);
  if (printed.length === 0) return false;
  const station = stationWords(stationName);
  return printed.every((word) => station.some((s) => wordsMatch(word, s)));
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
    case "llmDisabled":
      return "rail:import.empty.llmDisabled";
    case "llmCloudNotConsented":
      return "rail:import.empty.llmCloudNotConsented";
    case "llmProviderIncomplete":
      return "rail:import.empty.llmProviderIncomplete";
    case "otherDomain":
      return "rail:import.empty.otherDomain";
    case "looksLikeFlight":
      return "rail:import.empty.looksLikeFlight";
    default:
      return "rail:import.empty.nothingFound";
  }
}
