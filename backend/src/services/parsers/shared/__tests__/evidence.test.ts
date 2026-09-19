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

  it("accepts a confirmation phrase anywhere in the mail", () => {
    // The Emirates confirmations in the corpus print their onward legs
    // (EK051) with no route at all; only the SUBJECT says it is a booking,
    // which is why the phrase is looked for across the whole document.
    for (const phrase of [
      "Ihre Buchung ist bestätigt",
      "Deine Buchung ist da",
      "Buchungsnummer: ABC123",
      "Buchungscode ABC123",
      "Ihre Buchungsbestätigung",
      "Reservierungsnummer 4711",
      "Reservierungscode 4711",
      "Ticketnummer 220-1234567890",
      "Ihr E-Ticket",
      "PNR: JLNBLW",
      "Your booking is confirmed",
      "Booking reference ABC123",
      "Booking confirmation for your trip",
      "Confirmation number ABC123",
      "Record locator ABC123",
      "Your boarding pass",
      "Ihre Bordkarte",
    ]) {
      expect(hasSecondWitness("EK051", `${phrase}\nEK051`)).toBe(true);
    }
  });

  it("accepts the plural a family booking prints", () => {
    // Two travellers get "Ihre Bordkarten", not "Ihre Bordkarte". The closing
    // \b refused every one of these, which loses a real booking rather than
    // catching a fake one — the opposite of what this rule is for.
    for (const phrase of [
      "Ihre Bordkarten",
      "Ihre E-Tickets",
      "Ticketnummern 220-1 und 220-2",
      "Buchungsnummern ABC123 und ABC124",
      "Buchungscodes ABC123 und ABC124",
      "Ihre Buchungsbestätigungen",
      "Reservierungsnummern 4711 und 4712",
      "Reservierungscodes 4711 und 4712",
      "PNRs JLNBLW and GZFK7B",
      "Booking references ABC123 and ABC124",
      "Booking confirmations for your trip",
      "Confirmation numbers ABC123 and ABC124",
      "Record locators ABC123 and ABC124",
      "Your boarding passes",
    ]) {
      expect(hasSecondWitness("EK051", `${phrase}\nEK051`)).toBe(true);
    }
  });

  it("refuses the marketing words a bare vocabulary let through", () => {
    // Both measured in review against the first cut of this rule, which
    // matched single words document-wide: each of these flipped a marketing
    // mail back into a flight. A word like "Abflug" describes a service
    // anyone can advertise; a confirmation phrase describes a transaction
    // that already belongs to the reader.
    expect(
      hasSecondWitness(
        "FB23",
        `${NEWSLETTER}\nRegelmäßiger Abflug ab Flughafen Düsseldorf täglich.`
      )
    ).toBe(false);
    expect(
      hasSecondWitness("FB23", "Preisvergleich: FB23 bei Booking.com und anderen Anbietern.")
    ).toBe(false);
    // The rest of the retired word list, for the same reason.
    for (const word of ["Buchung", "Ticket", "Reservierung", "Boarding", "Departure", "booking"]) {
      expect(hasSecondWitness("FB23", `Aktion FB23 — ${word} jetzt entdecken`)).toBe(false);
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

  it("reaches across the tabular rows a real itinerary puts in between", () => {
    // Shaped on the "Buchungsdetails" layout that 19 of the 31 corpus mails
    // use: the flight number stands alone on its line and the departure time
    // is two tab-delimited rows below it, behind a weekday, a date and a long
    // airport name. "LH400 um 07:35" would not have exercised that distance —
    // and the distance is the whole reason WITNESS_WINDOW is 200 and not 40.
    // No confirmation phrase here on purpose: this pins the clock-time branch.
    const itinerary = [
      "LH 2316",
      "Mo\t13-Jan-25\tMünchen, Franz Josef Strauß - Flughafen (MUC)\tTerminal 2",
      "\t\tLuxemburg, Luxembourg (LUX)\tEconomy",
      "07:55\t08:55\tAirbus A319\t1h 00m",
    ].join("\n");

    expect(itinerary.indexOf("07:55") - itinerary.indexOf("LH 2316")).toBeGreaterThan(100);
    expect(hasSecondWitness("LH2316", itinerary)).toBe(true);
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
