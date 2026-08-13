import type { CurrencyCode } from "../shared/currencies";
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
  bookingId: string | null;
  stops: CruiseStop[];
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
}

export interface CruiseInput {
  shipId?: number | null;
  /** For the string/number fields below: `null` clears the stored value on
   *  update; `undefined` leaves it alone. */
  shipNameOverride?: string | null;
  cruiseLine?: string | null;
  routeName?: string | null;
  departurePortId?: number | null;
  arrivalPortId?: number | null;
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
