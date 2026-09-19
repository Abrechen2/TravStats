import {
  hasFlightEvidence,
  hasSecondWitness,
  isCredibleFlightNumber,
  keepOnlyFlightsWithEvidence,
} from "../evidence";
import type { ParsedBooking } from "../../../bookingParser";

/**
 * Forgejo #17 asked for this rule; Forgejo #35 showed it was only enforced on
 * the path that does not normally run; GitHub #291 showed a lone flight number
 * was never enough on its own. These tests pin the rule itself. The companion
 * tests in parsers/__tests__/email.evidence.test.ts and
 * parsers/__tests__/email.loneFlightNumber.test.ts pin that the factory
 * applies it to whatever provider answered.
 */
const booking = (over: Partial<ParsedBooking>): ParsedBooking => ({ ...over }) as ParsedBooking;

/**
 * A mail that says it is a booking.
 *
 * Most assertions here are about the flight FIELDS, not about the document, so
 * they are read against a document that corroborates a lone number. The cases
 * that are about the document say so in their own titles.
 */
const CONFIRMATION = "Ihre Buchung ist bestätigt\nAbflug 07:20";

describe("what counts as evidence of a flight", () => {
  it("accepts a flight number the mail corroborates", () => {
    expect(hasFlightEvidence(booking({ flightNumber: "LH2424" }), CONFIRMATION)).toBe(true);
  });

  it("accepts both ends of a route without a flight number", () => {
    // Plenty of confirmations name only airports — the gate must not demand a
    // flight number, or it would throw away real bookings to catch fake ones.
    // A route needs no second witness: it IS the second witness.
    expect(hasFlightEvidence(booking({ departureCode: "MUC", arrivalCode: "CDG" }), "")).toBe(true);
  });

  it("rejects one end of a route", () => {
    expect(hasFlightEvidence(booking({ departureCode: "MUC" }), CONFIRMATION)).toBe(false);
  });

  it("rejects a date, however complete it looks", () => {
    // The whole point. Every marketing email carries a date, and a date was
    // what turned an Emirates promotion into a booking.
    expect(
      hasFlightEvidence(
        booking({ departureTime: "2014-04-01T10:00", arrivalTime: "2014-04-01T12:00" }),
        CONFIRMATION
      )
    ).toBe(false);
  });

  it("rejects an empty candidate", () => {
    expect(hasFlightEvidence(booking({}), CONFIRMATION)).toBe(false);
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
    const kept = keepOnlyFlightsWithEvidence(flights, "ollama", CONFIRMATION);
    expect(kept).toHaveLength(2);
    expect(kept.map((f) => f.flightNumber ?? f.departureCode)).toEqual(["AF1123", "MUC"]);
  });

  it("reproduces the reported shape: three empty candidates become none", () => {
    // The rc.27 mail run against a "30 EUR Oster-Geschenk" promotion returned
    // exactly this — three candidates, every field null, HTTP 200.
    const kept = keepOnlyFlightsWithEvidence(
      [booking({}), booking({}), booking({})],
      "ollama",
      "Nur 7 Tage gültig: Ihr 30 EUR Oster-Geschenk"
    );
    expect(kept).toEqual([]);
  });

  it("returns a real answer untouched", () => {
    // Control probe: the filter must not be a filter that eats everything.
    const flights = [booking({ flightNumber: "AF1123" }), booking({ flightNumber: "AF2522" })];
    expect(keepOnlyFlightsWithEvidence(flights, "regex", CONFIRMATION)).toHaveLength(2);
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

describe("hasFlightEvidence — a route, or a corroborated number", () => {
  it("a route alone is evidence, whoever operates it", () => {
    expect(hasFlightEvidence({ departureCode: "MUC", arrivalCode: "CAI" }, "")).toBe(true);
    expect(
      hasFlightEvidence({ flightNumber: "ZZ9999", departureCode: "MUC", arrivalCode: "CAI" }, "")
    ).toBe(true);
  });

  it("a known airline's number is evidence once the mail corroborates it", () => {
    expect(hasFlightEvidence({ flightNumber: "LH99" }, CONFIRMATION)).toBe(true);
  });

  it("a price is not a flight, even with a date beside it", () => {
    expect(
      hasFlightEvidence({ flightNumber: "CHF0", departureTime: "2024-09-29T23:59" }, CONFIRMATION)
    ).toBe(false);
  });

  it("nothing is nothing", () => {
    expect(hasFlightEvidence({}, CONFIRMATION)).toBe(false);
    expect(hasFlightEvidence({ departureCode: "MUC" }, CONFIRMATION)).toBe(false);
  });
});

/**
 * GitHub #291 — the third half of the rule.
 *
 * A code can be a real airline and a coincidence at once, which is the whole
 * report: "FB" is Bulgaria Air, so a Facebook campaign called FB23 satisfied
 * every question the gate knew how to ask, and the only date in the mail
 * became its departure.
 */
describe("hasSecondWitness — a lone flight number needs corroboration (#291)", () => {
  const NEWSLETTER = [
    "Newsletter Oktober",
    "Unsere Facebook-Aktion FB23 läuft noch bis Freitag, 30. Oktober 2026.",
    "Flüge nach Barcelona ab 49 EUR.",
    "Ab Flughafen Düsseldorf täglich.",
  ].join("\n");

  it("refuses the reported newsletter, date and all", () => {
    expect(hasSecondWitness("FB23", NEWSLETTER)).toBe(false);
    expect(
      hasFlightEvidence(
        { airline: "FB", flightNumber: "FB23", departureTime: "2026-10-30T00:00" },
        NEWSLETTER
      )
    ).toBe(false);
  });

  it("accepts a clock time near the number", () => {
    // "LH400 um 07:35" — no route, no booking word, and still plainly a
    // flight. This is the case the rule must NOT cost us.
    expect(hasSecondWitness("LH400", "Erinnerung\nLH400 um 07:35")).toBe(true);
    expect(hasFlightEvidence({ flightNumber: "LH400" }, "Erinnerung\nLH400 um 07:35")).toBe(true);
  });

  it("accepts booking vocabulary anywhere in the mail", () => {
    // The Emirates confirmations in the corpus print their onward legs
    // (EK051) with no route at all; only the subject says it is a booking.
    for (const anchor of [
      "Ihre Buchung ist bestätigt",
      "Your booking is confirmed",
      "Reservierung 4711",
      "PNR: JLNBLW",
      "Ihr Ticket",
      "Boarding 06:55",
      "Abflug München",
      "Departure Munich",
    ]) {
      expect(hasSecondWitness("EK051", `${anchor}\nEK051`)).toBe(true);
    }
  });

  it("does not take a bare date as a witness", () => {
    // #17, #35 and #291 are all marketing mail carrying a date. If a date
    // counted, all three would reopen at once.
    expect(hasSecondWitness("LH400", "Gewinnspiel LH400 bis 30. Oktober 2026.")).toBe(false);
    expect(hasSecondWitness("LH400", "Aktion LH400 gültig 30.10.2026 bis 31.12.2026")).toBe(false);
  });

  it("does not take a clock time from the far end of a long mail", () => {
    // A newsletter footer printing office hours must not corroborate a
    // marketing token 800 characters above it.
    const footer = `Rabattcode FB23 einlösen.${" Mehr Ziele entdecken.".repeat(40)}\nService 09:00-17:00`;
    expect(hasSecondWitness("FB23", footer)).toBe(false);
  });

  it("finds the number even when the mail prints a space in it", () => {
    expect(hasSecondWitness("LH2316", "LH 2316\n07:55 MUC")).toBe(true);
  });

  it("refuses an empty document outright", () => {
    expect(hasSecondWitness("LH400", "")).toBe(false);
  });

  /**
   * The issue names two further tokens, `IYR724` and `MD2400`. Their mail
   * bodies are not in the issue, so these are the tokens rather than the
   * documents — and they are refused one question earlier than #291's rule:
   * neither prefix is an airline the catalogue knows. Pinned because a future
   * catalogue that learns "MD" would silently hand both a door.
   */
  it("refuses the issue's other named tokens", () => {
    for (const token of ["IYR724", "MD2400"]) {
      expect(hasFlightEvidence({ flightNumber: token }, "Newsletter Oktober 2026")).toBe(false);
    }
  });
});
