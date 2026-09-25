import type { Flight, FlightInput } from "../types";
import type { Cruise, CruiseInput } from "../types/cruise";
import type { CurrencyCode } from "../shared/currencies";
import type {
  CurrentValues,
  ExtractTarget,
  ExtractedSeatClass,
  ExtractedValues,
} from "./extractValues";

/**
 * The saved entry as an `ExtractTarget`: its current values for the preview,
 * and a save that sends only the ticked fields. For the detail pages, where the
 * entry is already stored — a form builds its own target from its state.
 */

/** The calendar day a flight departs, in the departure airport's zone. */
export function departureDay(
  flight: Pick<Flight, "departureTime" | "depTimezone">
): string | undefined {
  if (!flight.departureTime) return undefined;
  const date = new Date(flight.departureTime);
  if (Number.isNaN(date.getTime())) return undefined;
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone: flight.depTimezone || "UTC" }).format(date);
  } catch {
    return flight.departureTime.slice(0, 10);
  }
}

/** Only the ticked values; a null never leaves as "clear this field". */
function defined<T extends object>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== null && v !== undefined)
  ) as Partial<T>;
}

export function flightExtractTarget(
  flight: Flight,
  save: (updates: Partial<FlightInput>) => Promise<void>
): ExtractTarget {
  return {
    domain: "flight",
    ...flightHints(flight),
    current: {
      price: flight.price,
      currency: flight.currency,
      bookingReference: flight.bookingReference,
      seatNumber: flight.seatNumber,
      seatClass: flight.seatClass,
    },
    onApply: (values: Partial<ExtractedValues>) =>
      save(
        defined({
          price: values.price,
          currency: values.currency,
          bookingReference: values.bookingReference,
          seatNumber: values.seatNumber,
          seatClass: values.seatClass,
        }) as Partial<FlightInput>
      ),
  };
}

export function cruiseExtractTarget(
  cruise: Cruise,
  save: (updates: CruiseInput) => Promise<void>
): ExtractTarget {
  return {
    domain: "cruise",
    current: {
      price: cruise.price,
      currency: cruise.currency,
      bookingReference: cruise.bookingReference,
    },
    onApply: (values: Partial<ExtractedValues>) =>
      save(
        defined({
          price: values.price,
          bookingReference: values.bookingReference,
          // The server only proposes ISO 4217 codes (`isCurrencyCode`).
          currency: (values.currency ?? undefined) as CurrencyCode | undefined,
        }) as CruiseInput
      ),
  };
}

/** Extracted values as a form takes them: no nulls, only what was ticked. */
export interface AppliedValues {
  price?: number;
  currency?: string;
  bookingReference?: string;
  seatNumber?: string;
  seatClass?: ExtractedSeatClass;
}

/** The two hints that pick a stored flight's leg out of a multi-flight booking. */
export function flightHints(
  flight: Pick<Flight, "flightNumber" | "departureTime" | "depTimezone">
): { flightNumber?: string; departureDate?: string } {
  return { flightNumber: flight.flightNumber || undefined, departureDate: departureDay(flight) };
}

/**
 * A flight FORM as a target: the values go into its state, and are saved —
 * or not — with the rest of the form.
 */
export function flightFormExtract(
  hints: { flightNumber?: string; departureDate?: string },
  form: CurrentValues,
  apply: (values: AppliedValues) => void
): ExtractTarget {
  return {
    domain: "flight",
    ...hints,
    current: {
      price: form.price,
      currency: form.currency,
      bookingReference: form.bookingReference,
      seatNumber: form.seatNumber,
      seatClass: form.seatClass,
    },
    onApply: (values) => apply(defined(values) as AppliedValues),
  };
}
