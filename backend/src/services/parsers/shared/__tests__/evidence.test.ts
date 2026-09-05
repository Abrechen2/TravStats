import {
  hasFlightEvidence,
  isCredibleFlightNumber,
  keepOnlyFlightsWithEvidence,
} from "../evidence";
import type { ParsedBooking } from "../../../bookingParser";

/**
 * Forgejo #17 asked for this rule; Forgejo #35 showed it was only enforced on
 * the path that does not normally run. These tests pin the rule itself. The
 * companion test in parsers/__tests__/email.evidence.test.ts pins that the
 * factory applies it to whatever provider answered.
 */
const booking = (over: Partial<ParsedBooking>): ParsedBooking => ({ ...over }) as ParsedBooking;

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

/**
 * The second half of the evidence rule, added 2026-09-05 after the owner's
 * 108 hotel confirmations produced 38 "flights" through the flight parser —
 * every one a price or a word with digits after it, none with a route.
 */
describe("isCredibleFlightNumber — letters that name an airline", () => {
  it("accepts a number whose prefix the catalogue knows", () => {
    expect(isCredibleFlightNumber("LH99")).toBe(true);
    expect(isCredibleFlightNumber("EK050")).toBe(true);
    expect(isCredibleFlightNumber("lh2316")).toBe(true);
  });

  it("refuses a currency with an amount behind it", () => {
    for (const phantom of ["CHF0", "AED350", "NOK0", "USD1", "AUD0", "EUR934"]) {
      expect(isCredibleFlightNumber(phantom)).toBe(false);
    }
  });

  it("refuses words with digits after them", () => {
    for (const phantom of ["SIE20", "BIS14", "VON08", "OCT2026", "HWY7"]) {
      expect(isCredibleFlightNumber(phantom)).toBe(false);
    }
  });

  it("refuses nothing, and a prefix of the wrong length", () => {
    expect(isCredibleFlightNumber(undefined)).toBe(false);
    expect(isCredibleFlightNumber("")).toBe(false);
    expect(isCredibleFlightNumber("A123")).toBe(false);
    expect(isCredibleFlightNumber("ABCD12")).toBe(false);
  });
});

describe("hasFlightEvidence — a route, or a credible number", () => {
  it("a route alone is evidence, whoever operates it", () => {
    expect(hasFlightEvidence({ departureCode: "MUC", arrivalCode: "CAI" })).toBe(true);
    expect(
      hasFlightEvidence({ flightNumber: "ZZ9999", departureCode: "MUC", arrivalCode: "CAI" })
    ).toBe(true);
  });

  it("a known airline's number alone is evidence", () => {
    expect(hasFlightEvidence({ flightNumber: "LH99" })).toBe(true);
  });

  it("a price is not a flight, even with a date beside it", () => {
    expect(hasFlightEvidence({ flightNumber: "CHF0", departureTime: "2024-09-29T23:59" })).toBe(
      false
    );
  });

  it("nothing is nothing", () => {
    expect(hasFlightEvidence({})).toBe(false);
    expect(hasFlightEvidence({ departureCode: "MUC" })).toBe(false);
  });
});
