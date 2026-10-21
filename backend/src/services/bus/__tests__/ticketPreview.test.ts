import { describe, it, expect } from "@jest/globals";
import { busTicketProposals } from "../ticketPreview";
import type { ParsedRide, ParsedRideTicket } from "../../rides/v2RideTicket";

/**
 * A coach ticket prints one total. It is the price of a ride only when the
 * ticket holds one ride; split across several it would be counted once per
 * ride after import (the ferry preview answers the same way).
 */
const ride = (depName: string, arrName: string, departureLocal: string): ParsedRide => ({
  depName,
  arrName,
  departureLocal,
  arrivalLocal: null,
  carrier: "N 42",
});

const ticket = (rides: ParsedRide[]): ParsedRideTicket => ({
  domain: "bus",
  operator: "Fernbus Probeland",
  bookingReference: "FBP-309922",
  price: 44.5,
  currency: "EUR",
  rides,
  templateId: "bus:user-td",
  source: "workshop",
});

describe("busTicketProposals", () => {
  it("proposes the ticket total as the price of its only ride", () => {
    const [only] = busTicketProposals(
      ticket([ride("Probestadt ZOB", "Musterhafen ZOB", "2028-03-02T07:30")])
    );
    expect(only.price).toEqual({ value: "44.5", evidence: "44.5" });
    expect(only.currency).toEqual({ value: "EUR", evidence: "EUR" });
  });

  it("proposes no per-ride price from a total that covers several rides", () => {
    const rides = busTicketProposals(
      ticket([
        ride("Beispielberg", "Probestadt ZOB", "2028-04-10T09:15"),
        ride("Musterhafen ZOB", "Beispielberg", "2028-04-12T22:50"),
      ])
    );
    expect(rides).toHaveLength(2);
    for (const proposal of rides) {
      expect(proposal.price).toBeUndefined();
      expect(proposal.currency).toBeUndefined();
      expect(proposal.bookingReference).toEqual({ value: "FBP-309922", evidence: "FBP-309922" });
    }
  });
});
