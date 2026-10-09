import { saveErrorKey } from "../../lib/saveErrorMessage";
import type { Fold } from "../../lib/api/timeInput";
import type { BusJourney, BusJourneyInput, BusRideKind } from "../../types/bus";
import { toStationWallClock } from "../../lib/railTime";
import { railArrival, railDeparture } from "../../lib/entityTimes";
import { classifyWallClock, storedFold, type TimeValue } from "../../shared/time";
import { EMPTY_TERMINAL, type BusStationDraft } from "./BusStationField";

/**
 * The bus form's state and its translation to the write body — pure, so the
 * rules (what clears a field, when a distance counts as typed) are testable
 * without rendering a modal.
 */
export interface BusFormDraft {
  operator: string;
  lineName: string;
  rideKind: BusRideKind | "";
  departure: BusStationDraft;
  arrival: BusStationDraft;
  /** `YYYY-MM-DDTHH:mm` on the terminal's own clock; the clock part is ignored while that end is day-only. */
  departureLocal: string;
  arrivalLocal: string;
  /**
   * "Only the date is known", per end: a ride can state its departure clock and
   * only the arrival's day (or the reverse), and each end is sent as it was
   * stored — one flag for both would turn a day into an asserted midnight.
   */
  departureDayOnly: boolean;
  arrivalDayOnly: boolean;
  /**
   * Which occurrence of a repeated autumn hour the end's wall clock means, kept
   * from the stored ride so a save that does not touch the time resends the
   * instant it opened with. Null when the clock is not repeated or the user has
   * since typed a different one (the server then reads the earlier, as ever).
   */
  departureFold: Fold | null;
  arrivalFold: Fold | null;
  /** Only what the user typed. A measured distance is not shown here. */
  distanceKm: string;
  fareClass: string;
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
}

/**
 * The occurrence of a repeated hour a stored end is: the wall clock exists
 * twice, so the instant alone says which. "earlier" is named too (not folded
 * into null) so a test can tell the two stored states apart; the server reads
 * both the same as an absent fold.
 */
function storedEndFold(value: TimeValue | null): Fold | null {
  // A value with no zone reads as UTC, which has no repeated hour.
  if (!value || value.precision === "day" || !value.zone) return null;
  const local = value.local.slice(0, 16);
  if (classifyWallClock(local, value.zone) !== "repeated") return null;
  return storedFold(local, value.zone, value.utc) === "later" ? "later" : "earlier";
}

export function draftFrom(ride: BusJourney | null): BusFormDraft {
  if (!ride) {
    return {
      operator: "",
      lineName: "",
      rideKind: "",
      departure: EMPTY_TERMINAL,
      arrival: EMPTY_TERMINAL,
      departureLocal: "",
      arrivalLocal: "",
      departureDayOnly: false,
      arrivalDayOnly: false,
      departureFold: null,
      arrivalFold: null,
      distanceKm: "",
      fareClass: "",
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
    };
  }
  const departureValue = railDeparture(ride);
  const arrivalValue = railArrival(ride);
  return {
    operator: ride.operator ?? "",
    lineName: ride.lineName ?? "",
    rideKind: ride.rideKind ?? "",
    departure: {
      name: ride.depStationName,
      address: ride.depAddress ?? "",
      lat: ride.depLat,
      lon: ride.depLon,
      country: ride.depCountry,
    },
    arrival: {
      name: ride.arrStationName,
      address: ride.arrAddress ?? "",
      lat: ride.arrLat,
      lon: ride.arrLon,
      country: ride.arrCountry,
    },
    // Read back on each terminal's own clock — the time the ticket printed. A
    // bus row has rail's columns, so rail's readers accept it.
    departureLocal: toStationWallClock(departureValue),
    arrivalLocal: toStationWallClock(arrivalValue),
    // An end stored by its day alone must be edited as one: shown as 00:00 it
    // would be saved back as a midnight nobody stated. Read per end — the
    // arrival's precision is not the departure's.
    departureDayOnly: departureValue?.precision === "day",
    arrivalDayOnly: arrivalValue?.precision === "day",
    departureFold: storedEndFold(departureValue),
    arrivalFold: storedEndFold(arrivalValue),
    distanceKm:
      ride.distanceSource === "user" && ride.distanceKm !== null ? String(ride.distanceKm) : "",
    fareClass: ride.fareClass ?? "",
    seat: ride.seat ?? "",
    delayMinutes: ride.delayMinutes === null ? "" : String(ride.delayMinutes),
    bookingReference: ride.bookingReference ?? "",
    price: ride.price === null ? "" : String(ride.price),
    currency: ride.currency ?? "EUR",
    cancelled: ride.status === "cancelled",
    tags: [...ride.tags],
    companions: ride.companions,
    tripId: ride.tripId ?? "",
    notes: ride.notes ?? "",
  };
}

export function isTerminalComplete(station: BusStationDraft): boolean {
  return station.name.trim() !== "" && station.lat !== null && station.lon !== null;
}

export function canSubmit(draft: BusFormDraft): boolean {
  return (
    isTerminalComplete(draft.departure) &&
    isTerminalComplete(draft.arrival) &&
    draft.departureLocal !== ""
  );
}

/** Which typed coordinate of a terminal `LocationInput` refused, if any. */
export type BadCoordinate = "lat" | "lon" | null;

/** One reason the save is greyed out: the control that resolves it, and its words. */
export interface BusMissingStep {
  field: string;
  labelKey: string;
}

/**
 * What still keeps the save greyed out (forgejo#245), one step per gap and in
 * the form's order — the same conditions as `canSubmit` plus a refused
 * coordinate, so the hint can never name less than what blocks the button.
 * A terminal with a position but no name (a map click, a pasted coordinate)
 * names its NAME field: sending the user back to the search would be wrong.
 */
export function missingSteps(
  draft: BusFormDraft,
  bad: { departure: BadCoordinate; arrival: BadCoordinate }
): BusMissingStep[] {
  const terminal = (end: "departure" | "arrival"): BusMissingStep[] => {
    const prefix = end === "departure" ? "bus-dep" : "bus-arr";
    const short = end === "departure" ? "dep" : "arr";
    const station = draft[end];
    const steps: BusMissingStep[] = [];
    if (!isTerminalComplete(station)) {
      steps.push(
        station.lat !== null && station.lon !== null
          ? { field: `${prefix}-name`, labelKey: `bus:form.missing.${short}Name` }
          : { field: `${prefix}-search`, labelKey: `bus:form.${end}Station` }
      );
    }
    const refused = bad[end];
    if (refused !== null) {
      steps.push({
        field: `${prefix}-${refused}`,
        labelKey: `bus:form.missing.${short}Coordinates`,
      });
    }
    return steps;
  };
  return [
    ...terminal("departure"),
    ...terminal("arrival"),
    ...(draft.departureLocal === ""
      ? [
          {
            field: busFieldId("departureLocal"),
            // A day-only departure asks for a date, not a clock.
            labelKey: draft.departureDayOnly
              ? "bus:form.missing.departureDay"
              : "bus:form.missing.departureTime",
          },
        ]
      : []),
  ];
}

const orNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());
const numberOrNull = (value: string): number | null => {
  if (value.trim() === "") return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

function terminalInput(station: BusStationDraft): BusJourneyInput["departureStation"] {
  if (station.lat === null || station.lon === null) throw new Error("terminal without a position");
  return {
    name: station.name.trim(),
    address: orNull(station.address),
    lat: station.lat,
    lon: station.lon,
    country: station.country,
  };
}

/**
 * `YYYY-MM-DD` of a typed time, the part a "date only" end keeps. Named
 * `dayPart` because `lib/tripForDate.ts` already has a `dayOf` that means
 * something else.
 */
export const dayPart = (local: string): string => local.slice(0, 10);
/** A day carries no clock; a `datetime-local` input needs one, so it gets midnight to show. */
export const withClock = (local: string): string =>
  local.length === 10 ? `${local}T00:00` : local;

/**
 * True when the ride, as drafted, has an end without a clock — a delay is then
 * meaningless. An arrival that is not there at all constrains nothing (the
 * server reads an absent arrival as no clock to compare), so a ticked box
 * beside an empty arrival does not count.
 */
export const hasClocklessEnd = (draft: BusFormDraft): boolean =>
  draft.departureDayOnly || (draft.arrivalDayOnly && draft.arrivalLocal !== "");

/** The write body. Every optional field is SENT, null when empty — omitting it would keep the old value. */
export function toBusInput(draft: BusFormDraft): BusJourneyInput {
  // A delay is a difference between clocks; the server refuses one on a ride
  // with a clockless end, so it is not sent (the draft keeps it, in case the
  // box is unticked again).
  const delay = hasClocklessEnd(draft) ? null : numberOrNull(draft.delayMinutes);
  return {
    operator: orNull(draft.operator),
    lineName: orNull(draft.lineName),
    rideKind: draft.rideKind === "" ? null : draft.rideKind,
    departureStation: terminalInput(draft.departure),
    arrivalStation: terminalInput(draft.arrival),
    departureLocal: draft.departureDayOnly ? dayPart(draft.departureLocal) : draft.departureLocal,
    arrivalLocal:
      draft.arrivalLocal === ""
        ? null
        : draft.arrivalDayOnly
          ? dayPart(draft.arrivalLocal)
          : draft.arrivalLocal,
    // Always sent, null when none: omitting a fold would let the server fall
    // back to the earlier occurrence of a repeated hour (forgejo#214).
    departureFold: draft.departureDayOnly ? null : draft.departureFold,
    arrivalFold: draft.arrivalDayOnly || draft.arrivalLocal === "" ? null : draft.arrivalFold,
    distanceKm: numberOrNull(draft.distanceKm),
    fareClass: orNull(draft.fareClass),
    seat: orNull(draft.seat),
    delayMinutes: delay === null ? null : Math.round(delay),
    bookingReference: orNull(draft.bookingReference),
    price: numberOrNull(draft.price),
    currency: draft.currency || "EUR",
    status: draft.cancelled ? "cancelled" : "scheduled",
    tags: draft.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
    companions: draft.companions,
    tripId: draft.tripId === "" ? null : draft.tripId,
    notes: orNull(draft.notes),
  };
}

/**
 * The form fields a refusal can be shown beside (forgejo#246): every plain
 * input the server can name. Terminals, currency, tags and companions are
 * composite controls with no single input to mark, so a refusal naming one
 * stays in the banner, which names the field.
 */
export const BUS_FIELD_ERROR_FIELDS = [
  "departureLocal",
  "arrivalLocal",
  "operator",
  "lineName",
  "rideKind",
  "distanceKm",
  "fareClass",
  "seat",
  "delayMinutes",
  "bookingReference",
  "price",
  "tripId",
  "notes",
] as const;
export type BusFormErrorField = (typeof BUS_FIELD_ERROR_FIELDS)[number];

/** The DOM id of the input a refusal names — and the target a missing step focuses. */
export const busFieldId = (field: BusFormErrorField): string => `bus-${field}`;

/** A refused save as the form shows it: a message key, maybe beside one field. */
export interface BusSaveError {
  key: string;
  field: BusFormErrorField | null;
  /** For `invalidField`: the label of the field the server named. */
  fieldLabelKey?: string;
}

/** The server's field names, as the form labels them. */
const FIELD_LABEL_KEYS: Record<string, string> = {
  operator: "bus:form.operator",
  lineName: "bus:form.line",
  rideKind: "bus:form.kind",
  departureStation: "bus:form.departureStation",
  arrivalStation: "bus:form.arrivalStation",
  departureLocal: "bus:form.departureTime",
  arrivalLocal: "bus:form.arrivalTime",
  distanceKm: "bus:form.distance",
  fareClass: "bus:form.class",
  seat: "bus:form.seatNumber",
  delayMinutes: "bus:form.delay",
  bookingReference: "bus:form.bookingReference",
  price: "bus:form.price",
  currency: "bus:form.currency",
  tags: "bus:form.tags",
  companions: "bus:form.companions",
  tripId: "bus:form.trip",
  notes: "bus:form.notes",
};

const TIME_FIELDS: readonly string[] = ["departureLocal", "arrivalLocal"];
const isFieldErrorField = (field: string | null): field is BusFormErrorField =>
  field !== null && (BUS_FIELD_ERROR_FIELDS as readonly string[]).includes(field);

/**
 * A failed save, read by its stable `code` and `field`. The server's `error`
 * prose is English and written for a log — it is never shown; an unknown
 * refusal gets the generic sentence.
 */
export function saveErrorFrom(err: unknown): BusSaveError {
  const data = (err as { response?: { data?: { code?: unknown; field?: unknown } } })?.response
    ?.data;
  const code = typeof data?.code === "string" ? data.code : null;
  const field = typeof data?.field === "string" ? data.field : null;
  const timeField =
    field !== null && TIME_FIELDS.includes(field) && isFieldErrorField(field) ? field : null;
  switch (code) {
    case "BUS_ARRIVAL_BEFORE_DEPARTURE":
      return { key: "bus:form.errors.arrivalBeforeDeparture", field: "arrivalLocal" };
    // The time model's general codes (ADR 0002, D3).
    case "LOCAL_TIME_NONEXISTENT":
      return { key: "bus:form.errors.nonexistentTime", field: timeField };
    case "TZ_UNRESOLVED":
      return { key: "bus:form.errors.noZone", field: timeField };
    case "BUS_INVALID_INPUT": {
      const fieldLabelKey = field ? FIELD_LABEL_KEYS[field] : undefined;
      return fieldLabelKey
        ? {
            key: "bus:form.errors.invalidField",
            field: isFieldErrorField(field) ? field : null,
            fieldLabelKey,
          }
        : { key: "bus:form.errors.invalid", field: null };
    }
    default:
      // Everything that is not a bus field code reads through the shared save
      // rule (validation, duplicate, database down, demo, rate limit, no
      // network), so this dialog says what every other form says.
      return { key: saveErrorKey(err, "bus:form.saveError"), field: null };
  }
}

/**
 * The zone a terminal's typed time is on, where the form can know it: the
 * stored ride's zone (its `times`), while the terminal is still the one it
 * was stored with. A new pick has no zone here — the server finds it from the
 * coordinates — so the clock-change notice then stays silent and the server's
 * verdict stands.
 */
export function knownTerminalZone(
  ride: BusJourney | null,
  end: "dep" | "arr",
  station: BusStationDraft | null
): string | null {
  if (!ride || !station) return null;
  const lat = end === "dep" ? ride.depLat : ride.arrLat;
  const lon = end === "dep" ? ride.depLon : ride.arrLon;
  if (station.lat !== lat || station.lon !== lon) return null;
  const value = end === "dep" ? railDeparture(ride) : railArrival(ride);
  return value?.zone ?? null;
}
