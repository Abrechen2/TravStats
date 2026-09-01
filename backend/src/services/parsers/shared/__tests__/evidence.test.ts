import { hasFlightEvidence, keepOnlyFlightsWithEvidence } from "../evidence";
import type { ParsedBooking } from "../../../bookingParser";

/**
 * Forgejo #17 asked for this rule; Forgejo #35 showed it was only enforced on
 * the path that does not normally run. These tests pin the rule itself. The
 * companion test in parsers/__tests__/email.evidence.test.ts pins that the
 * factory applies it to whatever provider answered.
 */
const booking = (over: Partial<ParsedBooking>): ParsedBooking =>
  ({ ...over }) as ParsedBooking;

describe("what counts as evidence of a flight", () => {
  it("accepts a flight number on its own", () => {
    expect(hasFlightEvidence(booking({ flightNumber: "LH2424" }))).toBe(true);
  });

  it("accepts both ends of a route without a flight number", () => {
    // Plenty of confirmations name only airports — the gate must not demand a
    // flight number, or it would throw away real bookings to catch fake ones.
    expect(hasFlightEvidence(booking({ departureCode: "MUC", arrivalCode: "CDG" }))).toBe(true);
  });

  it("rejects one end of a route", () => {
    expect(hasFlightEvidence(booking({ departureCode: "MUC" }))).toBe(false);
  });

  it("rejects a date, however complete it looks", () => {
    // The whole point. Every marketing email carries a date, and a date was
    // what turned an Emirates promotion into a booking.
    expect(
      hasFlightEvidence(
        booking({ departureTime: "2014-04-01T10:00", arrivalTime: "2014-04-01T12:00" })
      )
    ).toBe(false);
  });

  it("rejects an empty candidate", () => {
    expect(hasFlightEvidence(booking({}))).toBe(false);
  });
});

describe("filtering a provider's answer", () => {
  it("drops the evidence-free candidates and keeps the rest", () => {
    const flights = [
      booking({ flightNumber: "AF1123" }),
      booking({}),
      booking({ departureCode: "MUC", arrivalCode: "CDG" }),
      booking({ departureTime: "2014-04-01T10:00" }),
    ];
    const kept = keepOnlyFlightsWithEvidence(flights, "ollama");
    expect(kept).toHaveLength(2);
    expect(kept.map((f) => f.flightNumber ?? f.departureCode)).toEqual(["AF1123", "MUC"]);
  });

  it("reproduces the reported shape: three empty candidates become none", () => {
    // The rc.27 mail run against a "30 EUR Oster-Geschenk" promotion returned
    // exactly this — three candidates, every field null, HTTP 200.
    const kept = keepOnlyFlightsWithEvidence([booking({}), booking({}), booking({})], "ollama");
    expect(kept).toEqual([]);
  });

  it("returns a real answer untouched", () => {
    // Control probe: the filter must not be a filter that eats everything.
    const flights = [booking({ flightNumber: "AF1123" }), booking({ flightNumber: "AF2522" })];
    expect(keepOnlyFlightsWithEvidence(flights, "regex")).toHaveLength(2);
  });
});
