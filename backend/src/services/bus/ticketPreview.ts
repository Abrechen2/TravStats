import { readRideTicket, type RideTicketFallbackCode } from "../rides/readRideTicket";
import type { ParsedRideTicket } from "../rides/v2RideTicket";

/**
 * The bus ticket preview (forgejo#309): a coach ticket read by `bus`
 * templates — the repository's, then the user's own workshop templates —
 * as proposals the form shows for review, never a saved ride. Template or
 * decline: there is no model path for a bus ticket, so a ticket no template
 * reads is answered with its reason, never an empty success.
 */

export const BUS_TICKET_FIELDS = [
  "departureStop",
  "arrivalStop",
  "departureLocal",
  "arrivalLocal",
  "operator",
  "lineName",
  "bookingReference",
  "price",
  "currency",
] as const;
export type BusTicketField = (typeof BUS_TICKET_FIELDS)[number];
export type BusTicketProposal = Partial<
  Record<BusTicketField, { value: string; evidence: string }>
>;

export interface BusTicketPreview {
  rides: BusTicketProposal[];
  parser: "template" | null;
  reason: "noText" | RideTicketFallbackCode | null;
  template: { id: string; source: "workshop" | "repository" } | null;
}

/** One proposal per ride; a template reads what the ticket prints, so each value is its own evidence. */
export function busTicketProposals(ticket: ParsedRideTicket): BusTicketProposal[] {
  const put = (target: BusTicketProposal, field: BusTicketField, value: string | number | null) => {
    if (value === null || value === "") return;
    target[field] = { value: String(value), evidence: String(value) };
  };
  const shared: BusTicketProposal = {};
  put(shared, "operator", ticket.operator);
  put(shared, "bookingReference", ticket.bookingReference);
  put(shared, "price", ticket.price);
  put(shared, "currency", ticket.currency);
  return ticket.rides.map((ride) => {
    const row: BusTicketProposal = {};
    put(row, "departureStop", ride.depName);
    put(row, "arrivalStop", ride.arrName);
    put(row, "departureLocal", ride.departureLocal);
    put(row, "arrivalLocal", ride.arrivalLocal);
    put(row, "lineName", ride.carrier);
    return { ...row, ...shared };
  });
}

export async function previewBusText(text: string, userId: string): Promise<BusTicketPreview> {
  const reading = await readRideTicket("bus", text, userId);
  if (!reading.ticket) {
    return { rides: [], parser: null, reason: reading.fallbackCode, template: null };
  }
  return {
    rides: busTicketProposals(reading.ticket),
    parser: "template",
    reason: null,
    template: { id: reading.ticket.templateId, source: reading.ticket.source },
  };
}
