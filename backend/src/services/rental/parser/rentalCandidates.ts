import { prisma } from "../../../db";
import type { CreateRentalBody } from "../../../schemas/rental";
import { resolveStationFromText, type StationResolution } from "./stationFromText";
import type { ParsedRentalConfirmation, ParsedRentalDocument, ParsedRentalInvoice } from "./types";

/**
 * What the review shows for one parsed rental document (spec
 * 2026-10-01-rental-domain-design §4.4, §4.5). Identity is provider +
 * confirmation number: a known number is an UPDATE, never a new row (Alamo
 * sends up to four mails per booking). A cancellation or an invoice only ever
 * acts on a booking this account already holds — with none it is declined as
 * `unknownBooking` and nothing is written.
 */
export type RentalCandidateAction = "create" | "update" | "cancel" | "invoice" | "declined";

export interface RentalImportCandidate {
  kind: ParsedRentalDocument["kind"];
  action: RentalCandidateAction;
  declineCode: "unknownBooking" | null;
  /** The booking this document acts on; null for a new one or a declined document. */
  existingId: string | null;
  parserTemplate: string;
  /** The write body for a confirmation — stations as the parser could place them. */
  input: CreateRentalBody | null;
  /** How each station was placed; `unresolved`/`ambiguous` must be answered before saving. */
  stations: { pickup: StationResolution; return: StationResolution } | null;
  invoice: ParsedRentalInvoice | null;
  confirmationNumber: string | null;
  provider: string;
}

/** The import key the parser writes (§3.1): `rental:<provider>:<confirmationNumber>`. */
export function rentalExternalRef(provider: string, confirmationNumber: string): string {
  return `rental:${provider.toLowerCase()}:${confirmationNumber}`;
}

async function bookingFor(
  userId: string,
  provider: string,
  numbers: { confirmation?: string | null; agreement?: string | null; invoice?: string | null }
): Promise<{ id: string } | null> {
  const or = [
    ...(numbers.confirmation ? [{ confirmationNumber: numbers.confirmation }] : []),
    ...(numbers.agreement ? [{ agreementNumber: numbers.agreement }] : []),
    ...(numbers.invoice ? [{ invoiceNumber: numbers.invoice }] : []),
  ];
  if (or.length === 0) return null;
  return prisma.rentalBooking.findFirst({
    where: { userId, provider: { equals: provider, mode: "insensitive" }, OR: or },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
}

function stationInput(name: string, resolution: StationResolution) {
  return resolution.status === "resolved"
    ? { name, airportId: resolution.airport.airportId }
    : { name };
}

async function confirmationCandidate(
  userId: string,
  doc: ParsedRentalConfirmation,
  parserTemplate: string
): Promise<RentalImportCandidate> {
  const pickup = await resolveStationFromText(doc.pickup.stationName, doc.placeHints);
  const sameName = doc.return.stationName === doc.pickup.stationName;
  const ret = sameName
    ? pickup
    : await resolveStationFromText(doc.return.stationName, doc.placeHints);
  const existing = await bookingFor(userId, doc.provider, { confirmation: doc.confirmationNumber });
  const input: CreateRentalBody = {
    provider: doc.provider,
    confirmationNumber: doc.confirmationNumber,
    pickupStation: stationInput(doc.pickup.stationName, pickup),
    returnStation: sameName ? null : stationInput(doc.return.stationName, ret),
    pickupLocal: doc.pickup.local,
    returnLocal: doc.return.local,
    vehicleClass: doc.vehicleClass,
    acrissCode: doc.acrissCode,
    vehicleExample: doc.vehicleExample,
    mileagePolicy: doc.mileagePolicy,
    paymentTiming: doc.paymentTiming,
    price: doc.price,
    currency: doc.currency,
    inclusions: doc.inclusions,
    status: "scheduled",
  };
  return {
    kind: "confirmation",
    action: existing ? "update" : "create",
    declineCode: null,
    existingId: existing?.id ?? null,
    parserTemplate,
    input,
    stations: { pickup, return: ret },
    invoice: null,
    confirmationNumber: doc.confirmationNumber,
    provider: doc.provider,
  };
}

export async function toRentalCandidate(
  doc: ParsedRentalDocument,
  parserTemplate: string,
  userId: string | undefined
): Promise<RentalImportCandidate> {
  if (doc.kind === "confirmation" && userId)
    return confirmationCandidate(userId, doc, parserTemplate);
  if (doc.kind === "confirmation") {
    // Without an account (a corpus measurement) the stations are still placed.
    const candidate = await confirmationCandidate("", doc, parserTemplate);
    return { ...candidate, action: "create", existingId: null };
  }
  const existing = userId
    ? await bookingFor(userId, doc.provider, {
        confirmation: doc.confirmationNumber,
        ...(doc.kind === "invoice"
          ? { agreement: doc.agreementNumber, invoice: doc.invoiceNumber }
          : {}),
      })
    : null;
  return {
    kind: doc.kind,
    action: existing ? (doc.kind === "invoice" ? "invoice" : "cancel") : "declined",
    declineCode: existing ? null : "unknownBooking",
    existingId: existing?.id ?? null,
    parserTemplate,
    input: null,
    stations: null,
    invoice: doc.kind === "invoice" ? doc : null,
    confirmationNumber: doc.confirmationNumber,
    provider: doc.provider,
  };
}
