import type { Flight, FlightInput } from "../types";
import { flightDeparture, railDeparture } from "./entityTimes";
import { dayOf } from "../shared/time";
import type { Cruise, CruiseWriteBody } from "../types/cruise";
import type { RailJourney, RailJourneyInput } from "../types/rail";
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

/** The calendar day a flight departs, at the departure airport (its `times.departure.local`). */
export function departureDay(flight: Parameters<typeof flightDeparture>[0]): string | undefined {
  const departure = flightDeparture(flight);
  return departure ? dayOf(departure) : undefined;
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
  save: (updates: CruiseWriteBody) => Promise<void>
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
        }) as CruiseWriteBody
      ),
  };
}

/**
 * A saved train ride. The seat and coach are the leg's; the train and the day
 * pick that leg out of a connection's ticket (the server abstains on them when
 * it cannot tell). The day is read on the departure station's clock.
 */
export function railExtractTarget(
  journey: RailJourney,
  save: (updates: Partial<RailJourneyInput>) => Promise<void>
): ExtractTarget {
  const train = [journey.trainCategory, journey.trainNumber].filter(Boolean).join(" ");
  const departure = railDeparture(journey);
  const day = departure ? dayOf(departure) : undefined;
  return {
    domain: "rail",
    ...(train ? { trainNumber: train } : {}),
    ...(day ? { departureDate: day } : {}),
    current: {
      price: journey.price,
      currency: journey.currency,
      bookingReference: journey.bookingReference,
      travelClass: journey.travelClass,
      coach: journey.coach,
      seatNumber: journey.seat,
    },
    onApply: (values: Partial<ExtractedValues>) =>
      save(
        defined({
          price: values.price,
          currency: values.currency,
          bookingReference: values.bookingReference,
          travelClass: values.travelClass,
          coach: values.coach,
          seat: values.seatNumber,
        }) as Partial<RailJourneyInput>
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
  flight: Pick<Flight, "flightNumber" | "departureTime" | "depTimezone"> &
    Partial<Pick<Flight, "times">>
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
