/**
 * The trip proposal a package-tour document becomes (plan 2026-10-09 P3).
 *
 * Every entity says what the commit will do with it — `create` a new row,
 * `attach` an existing one to the trip and booking, or `skip` it — and, for
 * the last two, which row it matched and why. Nothing is written while a
 * proposal is built; the review shows exactly this, and the commit re-builds
 * it server-side rather than trusting ids a client sends back.
 */
import { z } from "zod";
import type { AirportCandidate } from "./airportByCity";

export type EntityAction = "create" | "attach" | "skip";

/** Why an entity is skipped, or what about it the user must know. */
export const PROPOSAL_REASONS = [
  "duplicate",
  "onOtherTrip",
  "unresolvedAirport",
  "excluded",
  "undated",
] as const;
export type ProposalReason = (typeof PROPOSAL_REASONS)[number];

export const PROPOSAL_WARNINGS = [
  "airportAmbiguous",
  "airportUnknown",
  "priceConflict",
  "flightOnOtherTrip",
  "stayOnOtherTrip",
  "cruiseUndated",
  "documentFiledElsewhere",
] as const;
export type ProposalWarningCode = (typeof PROPOSAL_WARNINGS)[number];

export interface ProposalWarning {
  code: ProposalWarningCode;
  /** What the warning is about, as the document wrote it: a city, a flight number, a hotel. */
  subject: string;
}

export interface ProposalTrip {
  action: "create" | "attach";
  id: string | null;
  name: string;
  startDate: string | null;
  endDate: string | null;
  matchedBy: "bookingReference" | "dateOverlap" | null;
}

export interface ProposalBooking {
  action: "create" | "attach";
  id: string | null;
  reference: string;
  issuedOn: string;
  price: number | null;
  currency: string | null;
  travellers: number | null;
  /** What the existing booking already holds, when it differs from the document. */
  storedPrice?: { price: number | null; currency: string | null };
}

export interface ProposalEndpoint {
  iata: string | null;
  /** The place name as the document wrote it, when it gave a name instead of a code. */
  city: string | null;
  status: "given" | "resolved" | "chosen" | "ambiguous" | "unknown";
  candidates?: AirportCandidate[];
}

export interface ProposalFlight {
  index: number;
  action: EntityAction;
  id: string | null;
  reason?: ProposalReason;
  flightNumber: string;
  airline: string | null;
  date: string;
  depTime: string | null;
  arrTime: string | null;
  arrDayOffset: number;
  departure: ProposalEndpoint;
  arrival: ProposalEndpoint;
}

export interface ProposalStay {
  index: number;
  action: EntityAction;
  /** The matched stay, for attach/skip. */
  id: string | null;
  reason?: ProposalReason;
  lodging: { action: "create" | "reuse"; id: string | null };
  name: string;
  checkIn: string;
  checkOut: string;
  address: string | null;
  city: string | null;
  country: string | null;
  board: string | null;
  room: string | null;
}

export interface ProposalCruise {
  action: EntityAction;
  id: string | null;
  reason?: ProposalReason;
  ship: string | null;
  from: string | null;
  to: string | null;
  cabin: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface ProposalDocument {
  id: string;
  action: "file" | "skip";
  reason?: "alreadyOnTrip" | "filedElsewhere";
}

export interface PackageProposal {
  trip: ProposalTrip;
  booking: ProposalBooking;
  flights: ProposalFlight[];
  stays: ProposalStay[];
  cruise: ProposalCruise | null;
  document: ProposalDocument | null;
  warnings: ProposalWarning[];
}

/**
 * What the reviewer decided — the only input besides the document itself.
 * A city→IATA pick resolves every leg that names that city; an excluded index
 * is skipped with reason `excluded`; a trip name replaces the proposed one
 * when the trip is created.
 */
export const packageChoicesSchema = z
  .object({
    airports: z
      .record(
        z.string().trim().min(1).max(120),
        z
          .string()
          .regex(/^[A-Za-z]{3}$/)
          .transform((v) => v.toUpperCase())
      )
      .optional(),
    tripName: z.string().trim().min(1).max(200).optional(),
    excludeFlights: z.array(z.number().int().min(0)).max(40).optional(),
    excludeStays: z.array(z.number().int().min(0)).max(60).optional(),
    excludeCruise: z.boolean().optional(),
  })
  .strict();
export type PackageChoices = z.infer<typeof packageChoicesSchema>;
