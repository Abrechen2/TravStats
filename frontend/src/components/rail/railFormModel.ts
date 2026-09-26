import type {
  RailGeometryReport,
  RailJourney,
  RailJourneyInput,
  RailLookupAnswer,
  RailLookupStop,
  RailTravelClass,
} from "../../types/rail";
import { toStationWallClock } from "../../lib/railTime";
import { EMPTY_STATION, type RailStationDraft } from "./RailStationField";

/**
 * The rail form's state and its translation to the write body — pure, so the
 * rules (what clears a field, when a distance counts as typed) are testable
 * without rendering a modal.
 */
export interface RailFormDraft {
  operator: string;
  trainCategory: string;
  trainNumber: string;
  departure: RailStationDraft;
  arrival: RailStationDraft;
  departureLocal: string;
  arrivalLocal: string;
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
    // Read back on each station's own clock — the time the ticket printed.
    departureLocal: toStationWallClock(journey.departureTime, journey.depTimezone),
    arrivalLocal: toStationWallClock(journey.arrivalTime, journey.arrTimezone),
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
    departureLocal: draft.departureLocal,
    arrivalLocal: draft.arrivalLocal === "" ? null : draft.arrivalLocal,
    distanceKm: numberOrNull(draft.distanceKm),
    travelClass: draft.travelClass === "" ? null : draft.travelClass,
    coach: orNull(draft.coach),
    seat: orNull(draft.seat),
    delayMinutes: (() => {
      const n = numberOrNull(draft.delayMinutes);
      return n === null ? null : Math.round(n);
    })(),
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

/**
 * Take a lookup's answer over into the form: the train, the boarding stop
 * and the chosen alighting stop with their planned times, and the match
 * itself so the server can fetch the traced line when the journey is saved.
 * What the timetable cannot know — seat, price, delay, notes — is left as
 * the user had it. A planned time the provider did not give leaves the
 * user's own time standing rather than blanking it.
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
    operator: match.operator ?? draft.operator,
    trainCategory: match.trainCategory ?? draft.trainCategory,
    trainNumber: match.trainNumber ?? draft.trainNumber,
    departure: stationFromStop(from),
    arrival: stationFromStop(to),
    departureLocal: from.departureLocal ?? draft.departureLocal,
    arrivalLocal: to.arrivalLocal ?? draft.arrivalLocal,
    lookup: { provider: match.provider, ref: match.ref },
  };
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
    case "RAIL_LOCAL_TIME_NONEXISTENT":
      return { key: "rail:form.errors.nonexistentTime", field: timeField };
    case "RAIL_INVALID_INPUT": {
      const fieldLabelKey = field ? FIELD_LABEL_KEYS[field] : undefined;
      return fieldLabelKey
        ? { key: "rail:form.errors.invalidField", field: timeField, fieldLabelKey }
        : { key: "rail:form.errors.invalid", field: null };
    }
    default:
      return { key: "rail:form.saveError", field: null };
  }
}
