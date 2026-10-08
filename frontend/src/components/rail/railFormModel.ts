import { saveErrorKey } from "../../lib/saveErrorMessage";
import type {
  RailGeometryReport,
  RailJourney,
  RailJourneyInput,
  RailLookupAnswer,
  RailLookupStop,
  RailTravelClass,
} from "../../types/rail";
import { classifyWallClock, storedFold, type TimeValue } from "../../shared/time";
import { toStationWallClock } from "../../lib/railTime";
import { railArrival, railDeparture } from "../../lib/entityTimes";
import { EMPTY_STATION, type RailStationDraft } from "./RailStationField";

/**
 * The rail form's state and its translation to the write body — pure, so the
 * rules (what clears a field, when a distance counts as typed) are testable
 * without rendering a modal.
 */
export type RailFold = "earlier" | "later";

export interface RailFormDraft {
  operator: string;
  trainCategory: string;
  trainNumber: string;
  departure: RailStationDraft;
  arrival: RailStationDraft;
  /** `YYYY-MM-DDTHH:mm` on the station's own clock, or `YYYY-MM-DD` while its end is day-only. */
  departureLocal: string;
  arrivalLocal: string;
  /**
   * "Only the date is known", per end: the server takes a day or a clock for
   * each time on its own, so a ride can have a day for one end and a clock
   * for the other.
   */
  departureDayOnly: boolean;
  arrivalDayOnly: boolean;
  /**
   * Which of two occurrences of a repeated autumn hour each time is; null
   * where the time is not repeated. Read back from the stored instant so an
   * edit that does not touch a time resends it (forgejo#251), and reset when
   * the user types that time anew.
   */
  departureFold: RailFold | null;
  arrivalFold: RailFold | null;
  /** Only what the user typed. A measured distance is not shown here. */
  distanceKm: string;
  travelClass: RailTravelClass | "";
  coach: string;
  seat: string;
  delayMinutes: string;
  bookingReference: string;
  price: string;
  currency: string;
  cancelled: boolean;
  tags: string[];
  companions: string[];
  tripId: string;
  notes: string;
  /** The timetable trip a lookup matched; saved so the server can fetch its line. */
  lookup: RailJourneyInput["lookup"];
}

/** `YYYY-MM-DD` of a typed time, the part a "date only" ride keeps. */
export const dayPart = (local: string): string => local.slice(0, 10);

/** A day given a clock, so a `datetime-local` input can show it; a clock stays as it is. */
export const withClock = (local: string): string =>
  local.length === 10 ? `${local}T00:00` : local;

/** The station's own wall clock, or only its day for a ride stored without a time. */
function wallClockFor(value: TimeValue | null, dayOnly: boolean): string {
  return dayOnly ? dayPart(toStationWallClock(value)) : toStationWallClock(value);
}

/**
 * Which occurrence of a repeated hour a stored end is. The wall clock alone
 * cannot say: 02:30 on a clock-change night is two instants an hour apart, and
 * the server reads an unqualified one as the earlier.
 */
function foldOf(value: TimeValue | null, dayOnly: boolean): RailFold | null {
  if (!value?.zone || dayOnly) return null;
  const local = value.local.slice(0, 16);
  if (classifyWallClock(local, value.zone) !== "repeated") return null;
  return storedFold(local, value.zone, value.utc) === "later" ? "later" : "earlier";
}

export function draftFrom(journey: RailJourney | null): RailFormDraft {
  if (!journey) {
    return {
      operator: "",
      trainCategory: "",
      trainNumber: "",
      departure: EMPTY_STATION,
      arrival: EMPTY_STATION,
      departureLocal: "",
      arrivalLocal: "",
      departureDayOnly: false,
      arrivalDayOnly: false,
      departureFold: null,
      arrivalFold: null,
      distanceKm: "",
      travelClass: "",
      coach: "",
      seat: "",
      delayMinutes: "",
      bookingReference: "",
      price: "",
      currency: "EUR",
      cancelled: false,
      tags: [],
      companions: [],
      tripId: "",
      notes: "",
      lookup: null,
    };
  }
  const departureDayOnly = railDeparture(journey)?.precision === "day";
  const arrivalDayOnly = railArrival(journey)?.precision === "day";
  return {
    operator: journey.operator ?? "",
    trainCategory: journey.trainCategory ?? "",
    trainNumber: journey.trainNumber ?? "",
    departure: {
      name: journey.depStationName,
      lat: journey.depLat,
      lon: journey.depLon,
      country: journey.depCountry,
      code: journey.depStationCode,
      stationId: journey.depStationId,
    },
    arrival: {
      name: journey.arrStationName,
      lat: journey.arrLat,
      lon: journey.arrLon,
      country: journey.arrCountry,
      code: journey.arrStationCode,
      stationId: journey.arrStationId,
    },
    // Read back on each station's own clock — the time the ticket printed. A
    // ride stored by its day alone is edited as one: shown as 00:00 it would
    // be saved back as a midnight departure nobody stated (forgejo#212).
    departureLocal: wallClockFor(railDeparture(journey), departureDayOnly),
    arrivalLocal: wallClockFor(railArrival(journey), arrivalDayOnly),
    departureDayOnly,
    arrivalDayOnly,
    departureFold: foldOf(railDeparture(journey), departureDayOnly),
    arrivalFold: foldOf(railArrival(journey), arrivalDayOnly),
    distanceKm:
      journey.distanceSource === "user" && journey.distanceKm !== null
        ? String(journey.distanceKm)
        : "",
    travelClass: journey.travelClass ?? "",
    coach: journey.coach ?? "",
    seat: journey.seat ?? "",
    delayMinutes: journey.delayMinutes === null ? "" : String(journey.delayMinutes),
    bookingReference: journey.bookingReference ?? "",
    price: journey.price === null ? "" : String(journey.price),
    currency: journey.currency ?? "EUR",
    cancelled: journey.status === "cancelled",
    tags: [...journey.tags],
    companions: journey.companions,
    tripId: journey.tripId ?? "",
    notes: journey.notes ?? "",
    lookup:
      journey.lookupProvider && journey.lookupRef
        ? { provider: journey.lookupProvider, ref: journey.lookupRef }
        : null,
  };
}

/**
 * The next leg of a connection, prefilled from the leg before it: it leaves
 * from where that one arrived, no earlier than it arrived (on that station's
 * clock), in the same trip, class and company, under the same booking
 * reference. The train, the destination and the price are the new ticket's
 * and stay empty.
 */
export function connectionDraftFrom(previous: RailJourney): RailFormDraft {
  const before = draftFrom(previous);
  return {
    ...draftFrom(null),
    departure: before.arrival,
    departureLocal: before.arrivalLocal || before.departureLocal,
    // The leg starts where the one before ended, with that end's precision:
    // a day has no clock to start from, and inventing a 00:00 for it would
    // repeat forgejo#212 one leg later.
    departureDayOnly: before.arrivalLocal ? before.arrivalDayOnly : before.departureDayOnly,
    // The copied clock means the same occurrence it did on the leg before.
    departureFold: before.arrivalLocal ? before.arrivalFold : before.departureFold,
    travelClass: before.travelClass,
    bookingReference: before.bookingReference,
    currency: before.currency,
    companions: before.companions,
    tripId: before.tripId,
  };
}

/** A station the server will accept: a name AND a position. */
export function isStationComplete(station: RailStationDraft): boolean {
  return station.name.trim() !== "" && station.lat !== null && station.lon !== null;
}

export function canSubmit(draft: RailFormDraft): boolean {
  return (
    isStationComplete(draft.departure) &&
    isStationComplete(draft.arrival) &&
    draft.departureLocal !== ""
  );
}

const orNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());
const numberOrNull = (value: string): number | null => {
  if (value.trim() === "") return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const timeOf = (local: string, dayOnly: boolean): string => (dayOnly ? dayPart(local) : local);

const roundedOrNull = (value: string): number | null => {
  const n = numberOrNull(value);
  return n === null ? null : Math.round(n);
};

function stationInput(station: RailStationDraft): RailJourneyInput["departureStation"] {
  if (station.lat === null || station.lon === null) {
    throw new Error("station without a position");
  }
  return {
    stationId: station.stationId,
    name: station.name.trim(),
    code: station.code,
    lat: station.lat,
    lon: station.lon,
    country: station.country,
  };
}

/**
 * The write body. Every optional field is SENT, as null when empty: omitting
 * it would tell the server "keep the old value", and blanking a field in the
 * edit form would silently do nothing (the defect the cruise form had).
 */
export function toRailInput(draft: RailFormDraft): RailJourneyInput {
  return {
    operator: orNull(draft.operator),
    trainCategory: orNull(draft.trainCategory),
    trainNumber: orNull(draft.trainNumber),
    departureStation: stationInput(draft.departure),
    arrivalStation: stationInput(draft.arrival),
    departureLocal: timeOf(draft.departureLocal, draft.departureDayOnly),
    arrivalLocal:
      draft.arrivalLocal === "" ? null : timeOf(draft.arrivalLocal, draft.arrivalDayOnly),
    departureFold: draft.departureFold,
    arrivalFold: draft.arrivalFold,
    distanceKm: numberOrNull(draft.distanceKm),
    travelClass: draft.travelClass === "" ? null : draft.travelClass,
    coach: orNull(draft.coach),
    seat: orNull(draft.seat),
    // A delay is measured between clocks; the server refuses one on a ride
    // with a day-only end (RAIL_INVALID_INPUT).
    delayMinutes:
      draft.departureDayOnly || draft.arrivalDayOnly ? null : roundedOrNull(draft.delayMinutes),
    bookingReference: orNull(draft.bookingReference),
    price: numberOrNull(draft.price),
    currency: draft.currency || "EUR",
    status: draft.cancelled ? "cancelled" : "scheduled",
    tags: draft.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
    companions: draft.companions,
    tripId: draft.tripId === "" ? null : draft.tripId,
    notes: orNull(draft.notes),
    lookup: draft.lookup ?? null,
  };
}

function stationFromStop(stop: RailLookupStop): RailStationDraft {
  return {
    name: stop.name,
    lat: stop.lat,
    lon: stop.lon,
    country: stop.country,
    code: stop.code,
    stationId: stop.stationId,
  };
}

/** The user's value when they typed one, else the timetable's. */
function fillOnly(typed: string, fromTimetable: string | null): string {
  return typed.trim() !== "" ? typed : (fromTimetable ?? typed);
}

/** A typed value the lookup kept although the timetable says otherwise. */
export interface RailLookupKeptField {
  field: "operator" | "trainCategory";
  yours: string;
  timetable: string;
}

/** Where `applyLookup` kept the user's value over a different timetable one. */
export function lookupKeptFields(
  draft: RailFormDraft,
  match: NonNullable<RailLookupAnswer["match"]>
): RailLookupKeptField[] {
  const fields = [
    ["operator", draft.operator, match.operator],
    ["trainCategory", draft.trainCategory, match.trainCategory],
  ] as const;
  return fields.flatMap(([field, typed, timetable]) => {
    const yours = typed.trim();
    if (yours === "" || !timetable || yours.toLowerCase() === timetable.trim().toLowerCase()) {
      return [];
    }
    return [{ field, yours, timetable }];
  });
}

/**
 * Take a lookup's answer over into the form: the train, the boarding stop
 * and the chosen alighting stop with their planned times, and the match
 * itself so the server can fetch the traced line when the journey is saved.
 * What the timetable cannot know — seat, price, delay, notes — is left as
 * the user had it. A planned time the provider did not give leaves the
 * user's own time standing rather than blanking it.
 *
 * The operator and the category are FILLED, never replaced: a user who typed
 * "ÖBB" for a Railjet running on German track knows who they travelled with,
 * and the timetable's "Deutsche Bahn AG" overwrote it (acceptance 2026-09-26).
 * `lookupKeptFields` says where the two disagree, so the panel can show it.
 * The number is the query itself, so the timetable's split of it ("ICE 696"
 * into ICE + 696) is taken; the stations and times belong to the stop the
 * user picked in the panel, which is the choice "Übernehmen" confirms.
 */
export function applyLookup(
  draft: RailFormDraft,
  match: NonNullable<RailLookupAnswer["match"]>,
  arrivalIndex: number
): RailFormDraft {
  const from = match.stops[match.boardingIndex];
  const to = match.stops[arrivalIndex];
  if (!from || !to || arrivalIndex <= match.boardingIndex) {
    throw new Error("the arrival stop must come after the boarding stop");
  }
  return {
    ...draft,
    operator: fillOnly(draft.operator, match.operator),
    trainCategory: fillOnly(draft.trainCategory, match.trainCategory),
    trainNumber: match.trainNumber ?? draft.trainNumber,
    departure: stationFromStop(from),
    arrival: stationFromStop(to),
    // A planned time is a clock, so it ends "date only" for ITS end; an end
    // the timetable gives nothing for keeps the user's entry, day or clock.
    departureLocal: from.departureLocal ?? draft.departureLocal,
    departureDayOnly: from.departureLocal === null ? draft.departureDayOnly : false,
    departureFold: from.departureLocal === null ? draft.departureFold : null,
    arrivalLocal: to.arrivalLocal ?? draft.arrivalLocal,
    arrivalDayOnly: to.arrivalLocal === null ? draft.arrivalDayOnly : false,
    arrivalFold: to.arrivalLocal === null ? draft.arrivalFold : null,
    lookup: { provider: match.provider, ref: match.ref },
  };
}

/** ~1 km in degrees: nearer than this, a picked station IS the stop. */
const SAME_STOP_DEGREES = 0.01;

/**
 * Where the user still has to go after this train: the arrival they had
 * already chosen, when the stop they alight at is somewhere else. That is a
 * change of trains — the lookup found the first leg of a connection — and the
 * form offers the rest as a second journey on the same booking. Null when the
 * user had no arrival yet, or alights exactly there.
 */
export function onwardDestination(
  draft: RailFormDraft,
  match: NonNullable<RailLookupAnswer["match"]>,
  arrivalIndex: number
): RailStationDraft | null {
  const chosen = draft.arrival;
  const stop = match.stops[arrivalIndex];
  if (!stop || !isStationComplete(chosen) || chosen.lat === null || chosen.lon === null) {
    return null;
  }
  const apart = Math.hypot(stop.lat - chosen.lat, stop.lon - chosen.lon);
  return apart < SAME_STOP_DEGREES ? null : chosen;
}

/**
 * The next leg of a connection, continuing to a destination the user had
 * already picked before the lookup split the ride (see `onwardDestination`).
 */
export function onwardDraftFrom(previous: RailJourney, destination: RailStationDraft | null) {
  const next = connectionDraftFrom(previous);
  return destination ? { ...next, arrival: destination } : next;
}

/**
 * What the form says after a save that asked for a traced line and did not
 * get one (review 2026-09-26, finding 4) — before, "saved" was all it said and
 * the map quietly drew the chord. Null when there is nothing to say.
 */
export function geometryNotice(
  report: RailGeometryReport | null
): { level: "warning" | "info"; key: string; reasonKey: string } | null {
  if (!report || report.fallback === null) return null;
  const reasonKey = `rail:geometryNotice.reason.${report.fallback}`;
  if (report.outcome === "straight") {
    return { level: "warning", key: "rail:geometryNotice.straight", reasonKey };
  }
  if (report.outcome === "kept")
    return { level: "info", key: "rail:geometryNotice.kept", reasonKey };
  // A trace was asked for and the line was routed over the tracks instead.
  if (report.outcome === "routed")
    return { level: "info", key: "rail:geometryNotice.routed", reasonKey };
  return null;
}

/** The form fields a refusal can be shown beside. */
export type RailFormErrorField = "departureLocal" | "arrivalLocal";

/** A refused save as the form shows it: a message key, maybe beside one field. */
export interface RailSaveError {
  key: string;
  field: RailFormErrorField | null;
  /** For `invalidField`: the label of the field the server named. */
  fieldLabelKey?: string;
}

/** The server's field names, as the form labels them. */
const FIELD_LABEL_KEYS: Record<string, string> = {
  operator: "rail:form.operator",
  trainCategory: "rail:form.category",
  trainNumber: "rail:form.number",
  departureStation: "rail:form.departureStation",
  arrivalStation: "rail:form.arrivalStation",
  departureLocal: "rail:form.departureTime",
  arrivalLocal: "rail:form.arrivalTime",
  distanceKm: "rail:form.distance",
  travelClass: "rail:form.class",
  coach: "rail:form.coach",
  seat: "rail:form.seatNumber",
  delayMinutes: "rail:form.delay",
  bookingReference: "rail:form.bookingReference",
  price: "rail:form.price",
  currency: "rail:form.currency",
  tags: "rail:form.tags",
  companions: "rail:form.companions",
  tripId: "rail:form.trip",
  notes: "rail:form.notes",
};

const TIME_FIELDS: readonly string[] = ["departureLocal", "arrivalLocal"];

/**
 * A failed save, read by its stable `code` and `field` (review 2026-09-26,
 * finding 5). The server's `error` prose is English and written for a log —
 * it is never shown; an unknown refusal gets the generic sentence.
 */
export function saveErrorFrom(err: unknown): RailSaveError {
  const data = (err as { response?: { data?: { code?: unknown; field?: unknown } } })?.response
    ?.data;
  const code = typeof data?.code === "string" ? data.code : null;
  const field = typeof data?.field === "string" ? data.field : null;
  const timeField = field && TIME_FIELDS.includes(field) ? (field as RailFormErrorField) : null;
  switch (code) {
    case "RAIL_ARRIVAL_BEFORE_DEPARTURE":
      return { key: "rail:form.errors.arrivalBeforeDeparture", field: "arrivalLocal" };
    // The rail code and the time model's general one (ADR 0002, D3).
    case "RAIL_LOCAL_TIME_NONEXISTENT":
    case "LOCAL_TIME_NONEXISTENT":
      return { key: "rail:form.errors.nonexistentTime", field: timeField };
    case "RAIL_INVALID_INPUT": {
      const fieldLabelKey = field ? FIELD_LABEL_KEYS[field] : undefined;
      return fieldLabelKey
        ? { key: "rail:form.errors.invalidField", field: timeField, fieldLabelKey }
        : { key: "rail:form.errors.invalid", field: null };
    }
    default:
      // Everything that is not a rail field code reads through the shared
      // save rule (validation, duplicate, database down, demo, rate limit,
      // no network), so the rail dialog says what every other form says.
      return { key: saveErrorKey(err, "rail:form.saveError"), field: null };
  }
}

/**
 * The zone a station's typed time is on, where the form can know it: the
 * stored journey's zone (its `times`), while the station is still the one it
 * was stored with. A new pick has no zone here — the server finds it from the
 * coordinates — so the clock-change notice then stays silent and the server's
 * verdict stands.
 */
export function knownStationZone(
  journey: RailJourney | null,
  end: "dep" | "arr",
  station: RailStationDraft | null
): string | null {
  if (!journey || !station) return null;
  const lat = end === "dep" ? journey.depLat : journey.arrLat;
  const lon = end === "dep" ? journey.depLon : journey.arrLon;
  if (station.lat !== lat || station.lon !== lon) return null;
  const value = end === "dep" ? railDeparture(journey) : railArrival(journey);
  return value?.zone ?? null;
}
