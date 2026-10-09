import type {
  CabinType,
  Cruise,
  CruiseInput,
  CruiseStatus,
  CruiseStop,
  CruiseStopInput,
  CruiseWriteBody,
  Port,
  Ship,
} from "../../types";
import { dayInput } from "../../lib/api/timeInput";
import { cruiseStopToWire, storedStopFold } from "./cruiseStopWire";
import { suggestedCruiseEndDate, withDerivedStopDates } from "./cruiseDayNumbers";

/** Everything the cruise form edits, as its inputs hold it. */
export interface CruiseFormFields {
  ship: Ship | null;
  cruiseLine: string;
  routeName: string;
  startDate: string;
  endDate: string;
  status: CruiseStatus;
  color: string | null;
  departurePort: Port | null;
  arrivalPort: Port | null;
  stops: CruiseStopInput[];
  cabinNumber: string;
  cabinType: CabinType | "";
  deck: string;
  bookingReference: string;
  price: string;
  currency: string;
  tags: string[];
  companions: string[];
  notes: string;
  tripId: string;
}

// Cruise start/end are date-granular (a voyage spans whole days): the date
// input's "YYYY-MM-DD" is read straight off the stored value, never through a
// zone (the drift that moved Berlin's 00:00 to the day before).
const toDateInput = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : "");

/**
 * A stored cruise's stops as the stops editor holds them. Each keeps its
 * stored id as the editor key, so reordering follows the stop (forgejo#221),
 * and the later occurrence of a repeated hour is read back from the instant.
 */
export function stopInputsOf(stops: readonly CruiseStop[]): CruiseStopInput[] {
  return stops.map((s) => ({
    uiKey: s.id,
    portId: s.portId,
    port: s.port,
    dayNumber: s.dayNumber,
    date: s.date,
    isAtSea: s.isAtSea,
    arrivalTime: s.arrivalTime,
    departureTime: s.departureTime,
    arrivalFold: storedStopFold(s.arrivalTime, s.arrivalUtc, s.stopZone),
    departureFold: storedStopFold(s.departureTime, s.departureUtc, s.stopZone),
    excursionNote: s.excursionNote ?? undefined,
    unresolvedPortName: s.unresolvedPortName,
  }));
}

/**
 * The form's starting values — read by the state AND by the dirty guard, so
 * an untouched edit form can never open already "changed" (forgejo#248).
 * A new cruise starts in the account's base currency; an existing one keeps
 * what it was saved with. `cruise` without `mode: edit` is a duplicate's source.
 */
export function cruiseFormFields(
  cruise: Cruise | undefined,
  baseCurrency: string | null | undefined
): CruiseFormFields {
  return {
    ship: cruise?.ship ?? null,
    cruiseLine: cruise?.cruiseLine ?? "",
    routeName: cruise?.routeName ?? "",
    startDate: toDateInput(cruise?.startDate),
    endDate: toDateInput(cruise?.endDate),
    status: cruise?.status ?? "scheduled",
    color: cruise?.color ?? null,
    departurePort: cruise?.departurePort ?? null,
    arrivalPort: cruise?.arrivalPort ?? null,
    stops: stopInputsOf(cruise?.stops ?? []),
    cabinNumber: cruise?.cabinNumber ?? "",
    cabinType: cruise?.cabinType ?? "",
    deck: cruise?.deck?.toString() ?? "",
    bookingReference: cruise?.bookingReference ?? "",
    price: cruise?.price?.toString() ?? "",
    currency: cruise?.currency ?? baseCurrency ?? "EUR",
    tags: cruise?.tags ?? [],
    companions: cruise?.companions ?? [],
    notes: cruise?.notes ?? "",
    tripId: cruise?.tripId ?? "",
  };
}

/**
 * The form as it settles right after opening: `useCruiseDateSuggestions`
 * fills an empty stop date from the start date and an empty end date from the
 * last day of the cruise in its first effects. Those are the form's own
 * suggestions, not the user's edits — the dirty baseline is taken from THIS,
 * or every cruise with an undated stop would ask "discard changes?" when
 * closed untouched. Same two functions the hook runs, so the two cannot drift.
 */
export function cruiseFormOpening(fields: CruiseFormFields): CruiseFormFields {
  const stops = withDerivedStopDates(fields.stops, fields.startDate);
  const endDate = fields.endDate || suggestedCruiseEndDate(fields.startDate, stops);
  return { ...fields, stops, endDate };
}

/**
 * What the dirty guard compares: the saved, user-visible values only — ids
 * instead of picked objects, and none of the editor's bookkeeping (`uiKey`,
 * `originalDay`, `dateSource`). Stop ORDER counts: a reorder is a change.
 */
export function cruiseFormSnapshot(fields: CruiseFormFields): Record<string, unknown> {
  return {
    ...fields,
    ship: fields.ship?.id ?? null,
    departurePort: fields.departurePort?.id ?? null,
    arrivalPort: fields.arrivalPort?.id ?? null,
    stops: fields.stops.map((s) => ({
      portId: s.portId,
      unresolvedPortName: s.unresolvedPortName,
      isAtSea: s.isAtSea,
      dayNumber: s.dayNumber,
      date: s.date?.slice(0, 10) ?? null,
      arrivalTime: s.arrivalTime?.slice(0, 16) ?? null,
      departureTime: s.departureTime?.slice(0, 16) ?? null,
      arrivalFold: s.arrivalFold,
      departureFold: s.departureFold,
      excursionNote: s.excursionNote,
    })),
  };
}

/** Field rules the server enforces too (`backend/src/schemas/cruise.ts`). */
export interface CruiseFieldErrors {
  endDate?: string;
  deck?: string;
  price?: string;
}

/**
 * Checked here so the refusal lands AT the field (forgejo#246): an end before
 * the start, a deck outside 1–30 or a negative price came back from the server
 * as the form's one generic sentence, naming nothing.
 */
export function cruiseFieldErrors(fields: {
  startDate: string;
  endDate: string;
  deck: string;
  price: string;
}): CruiseFieldErrors {
  const errors: CruiseFieldErrors = {};
  if (fields.startDate && fields.endDate && fields.endDate < fields.startDate) {
    errors.endDate = "cruise:form.errors.endBeforeStart";
  }
  const deck = fields.deck.trim();
  if (deck && !(/^\d+$/.test(deck) && Number(deck) >= 1 && Number(deck) <= 30)) {
    errors.deck = "cruise:form.errors.deck";
  }
  const price = fields.price.trim();
  if (price && !(Number.isFinite(Number(price)) && Number(price) >= 0)) {
    errors.price = "cruise:form.errors.price";
  }
  return errors;
}

/** A stop the server would refuse: not a sea day, no port, no imported name. */
export function stopLacksPort(stop: CruiseStopInput): boolean {
  return !stop.isAtSea && stop.portId == null && !stop.unresolvedPortName;
}

/**
 * What a new cruise must carry to exist at all (`cruiseHasIdentity` and the
 * start-date rule in backend schemas/cruise.ts). Create only, like the server:
 * an existing row is edited as it is.
 */
export function lacksIdentity(fields: CruiseFormFields, shipNameOverride?: string | null): boolean {
  return (
    !fields.ship &&
    !fields.routeName.trim() &&
    !fields.cruiseLine.trim() &&
    !fields.departurePort &&
    !shipNameOverride?.trim()
  );
}

/** The write body. `null` is an explicit clear — `undefined` would keep the old value. */
export function cruiseWriteBody(fields: CruiseFormFields): CruiseWriteBody {
  return {
    shipId: fields.ship?.id ?? null,
    cruiseLine: fields.cruiseLine || null,
    routeName: fields.routeName || null,
    departurePortId: fields.departurePort?.id ?? null,
    arrivalPortId: fields.arrivalPort?.id ?? null,
    // Sent as the bare day (ADR 0002): a day is not an instant, and the server
    // stores it as a DATE — no midnight-UTC anchor to drift across zones.
    startDate: dayInput(fields.startDate),
    endDate: dayInput(fields.endDate),
    status: fields.status,
    color: fields.color,
    cabinNumber: fields.cabinNumber || null,
    cabinType: (fields.cabinType || null) as CabinType | null,
    deck: fields.deck ? Number.parseInt(fields.deck, 10) : null,
    bookingReference: fields.bookingReference || null,
    price: fields.price ? Number.parseFloat(fields.price) : null,
    currency: (fields.currency || "EUR") as CruiseInput["currency"],
    tags: fields.tags,
    companions: fields.companions,
    notes: fields.notes || null,
    tripId: fields.tripId || null,
    // Always sent, including as []: omitting the field when the user removed
    // every stop would silently keep the old stops (the server reads absence
    // as "don't touch").
    stops: fields.stops.map(cruiseStopToWire),
  };
}
