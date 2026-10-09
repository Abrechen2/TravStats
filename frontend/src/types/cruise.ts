import type { LocalTimeInput } from "../shared/time";
import type { CurrencyCode } from "../shared/currencies";
import type { CruiseStopTimes, CruiseTimes } from "./times";
export interface Ship {
  id: number;
  name: string;
  imo: string | null;
  cruiseLine: string;
  yearBuilt: number | null;
  grossTonnage: number | null;
  capacity: number | null;
  status: string;
  isUserAdded: boolean;
}

export interface Port {
  id: number;
  name: string;
  city: string | null;
  country: string | null;
  unlocode: string | null;
  lat: number;
  lon: number;
  timezone: string | null;
  region: string | null;
  isUserAdded: boolean;
}

export interface CruiseStop {
  id: string;
  cruiseId: string;
  portId: number | null;
  port: Port | null;
  dayNumber: number;
  /** Calendar date of the stop (ISO) or null. */
  date: string | null;
  isAtSea: boolean;
  arrivalTime: string | null;
  departureTime: string | null;
  excursionNote: string | null;
  /** Set on an unresolved port: name-only stop, portId=null, isAtSea=false. */
  unresolvedPortName: string | null;
  /** The real instants and the port's zone (ADR 0002 phase 2); absent on older rows. */
  arrivalUtc?: string | null;
  departureUtc?: string | null;
  stopZone?: string | null;
  /** ADR 0002 phase 4 — read through lib/entityTimes.ts. */
  times?: CruiseStopTimes;
}

export type CruiseStatus = "scheduled" | "in_progress" | "flown" | "cancelled" | "historical";
export type CabinType = "inside" | "oceanview" | "balcony" | "suite";

export interface Cruise {
  id: string;
  userId: string;
  shipId: number | null;
  ship: Ship | null;
  shipNameOverride: string | null;
  cruiseLine: string | null;
  routeName: string | null;
  departurePortId: number | null;
  departurePort: Port | null;
  arrivalPortId: number | null;
  arrivalPort: Port | null;
  startDate: string | null;
  endDate: string | null;
  status: CruiseStatus;
  /** Optional user-selectable map color (hex). Null = auto-derived from id. */
  color?: string | null;
  cabinNumber: string | null;
  cabinType: CabinType | null;
  deck: number | null;
  bookingReference: string | null;
  price: number | null;
  currency: string | null;
  notes: string | null;
  tags: string[];
  companions: string[];
  tripId: string | null;
  /**
   * The linked trip, id + name + colour only — what the list cell and the
   * detail header need to name and colour it. Included by the API alongside
   * ship/ports (CRUISE_INCLUDE), so nothing has to resolve tripId separately.
   * Optional because older fixtures and the create payload never carry it.
   */
  trip?: { id: string; name: string; color: string } | null;
  bookingId: string | null;
  stops: CruiseStop[];
  times?: CruiseTimes;
  createdAt: string;
  updatedAt: string;
}

export interface CruiseStopInput {
  portId: number | null;
  dayNumber: number;
  date?: string | null;
  isAtSea: boolean;
  arrivalTime?: string | null;
  departureTime?: string | null;
  excursionNote?: string;
  /** Unresolved port name (import couldn't match the catalog). Cleared when
   *  the user picks a real port. */
  unresolvedPortName?: string | null;
  /** UI-only: the resolved Port for this stop, so the stops editor can show
   *  the selected port when editing an existing cruise. Not sent to the
   *  backend — the submit mapper strips it (backend Zod also ignores it). */
  port?: Port | null;
  /** UI-only: the day this stop was loaded with, so the stops editor can keep
   *  it (`null` = added in the editor, `undefined` = not touched yet, which
   *  means its `dayNumber` IS the loaded day). Stripped on submit like `port`.
   *  See `cruiseDayNumbers.ts` (forgejo#126). */
  originalDay?: number | null;
  /** UI-only: where `date` came from — `"derived"` = filled from the cruise
   *  start date and the day number (keeps following both), `"user"` = typed
   *  (never touched again), `undefined` = as loaded. Stripped on submit. */
  dateSource?: "derived" | "user";
  /** UI-only: the later occurrence of a repeated hour was meant (ADR 0002
   *  Q5). Sent as the time's `fold`, stripped from the stop itself. */
  arrivalFold?: "later";
  departureFold?: "later";
  /** UI-only: which stop this is while the list is reordered, so the open day
   *  and the keyboard focus follow a moved stop instead of staying at its old
   *  position (forgejo#221). The stored stop's id where there is one. Stripped
   *  on submit like `port`. */
  uiKey?: string;
}

export interface CruiseInput {
  /**
   * Set when the cruise arrives from an import. Its presence is what tells
   * the server the row came from a source, so the server can derive where
   * from — the rule for "the same cruise" stays on the server side.
   */
  importBatchId?: string | null;
  shipId?: number | null;
  /** For the string/number fields below: `null` clears the stored value on
   *  update; `undefined` leaves it alone. */
  shipNameOverride?: string | null;
  cruiseLine?: string | null;
  routeName?: string | null;
  departurePortId?: number | null;
  arrivalPortId?: number | null;
  /** The first/last day, `YYYY-MM-DD` (ADR 0002: a day is never an instant). */
  startDate?: string | null;
  endDate?: string | null;
  status?: CruiseStatus;
  /** Optional user-selectable map color (hex). Null = auto-derived from id. */
  color?: string | null;
  cabinNumber?: string | null;
  cabinType?: CabinType | null;
  deck?: number | null;
  bookingReference?: string | null;
  price?: number | null;
  currency?: CurrencyCode;
  notes?: string | null;
  tags?: string[];
  companions?: string[];
  tripId?: string | null;
  bookingId?: string | null;
  stops?: CruiseStopInput[];
}

/** The body `POST/PUT /cruises` takes: stops in the time model's write shape. */
export type CruiseWriteBody = Omit<CruiseInput, "stops"> & { stops?: CruiseStopWire[] };

/**
 * A stop as the write body carries it (ADR 0002, D3): the call's day as
 * `YYYY-MM-DD`, each time as `{local, zone | placeRef}`. Built from the
 * editor's `CruiseStopInput` by `components/Cruise/cruiseStopWire.ts`.
 */
export type CruiseStopWire = Omit<
  CruiseStopInput,
  | "port"
  | "originalDay"
  | "dateSource"
  | "date"
  | "arrivalTime"
  | "departureTime"
  | "arrivalFold"
  | "departureFold"
  | "uiKey"
> & {
  date?: string | null;
  arrivalTime?: LocalTimeInput | null;
  departureTime?: LocalTimeInput | null;
};
