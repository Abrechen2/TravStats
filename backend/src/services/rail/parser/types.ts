import type { RAIL_TRAVEL_CLASSES } from "../../../schemas/rail";

/**
 * What a rail ticket parser reads out of a document — before any station is
 * looked up. Every field is what the document PRINTS; a value it does not
 * print is null, never a guess (the abstention rule in CLAUDE.md). A train
 * number in particular is only ever copied, because a short-distance DB ticket
 * carries none and an invented one would be looked up, mapped and counted.
 */

export type RailTravelClassValue = (typeof RAIL_TRAVEL_CLASSES)[number];

/** Which reader produced a booking; kept so a wrong reading can be traced. */
export type RailParseSource =
  | "db-confirmation"
  | "db-online-ticket"
  | "db-postal-order"
  | "db-connection-info"
  | "ics"
  | "ollama";

export interface ParsedRailLeg {
  depStationName: string;
  arrStationName: string;
  /** `YYYY-MM-DDTHH:mm` on the departure station's clock, as printed. */
  departureLocal: string;
  /** Same, on the arrival station's clock; null when the document names none. */
  arrivalLocal: string | null;
  trainCategory: string | null;
  trainNumber: string | null;
  coach: string | null;
  seat: string | null;
  /** "Hinfahrt" / "Rückfahrt" when the document sections its legs. */
  direction: "outbound" | "return" | null;
}

export interface ParsedRailBooking {
  /** DB "Auftragsnummer", a PNR, a Trainline reference. */
  bookingReference: string | null;
  travelClass: RailTravelClassValue | null;
  /** The fare as printed ("Flexpreis", "Einzelfahrkarte Kurzstrecke") — kept as a note. */
  tariff: string | null;
  /** The TOTAL the document labels as such; per-leg prices are not invented. */
  price: number | null;
  currency: string | null;
  operator: string | null;
  legs: ParsedRailLeg[];
  source: RailParseSource;
}

/** A file that came with a mail: its name, its type, and its bytes. */
export interface RailAttachment {
  filename?: string;
  mediaType: string;
  content: Buffer;
}
