import { documentDefect, getRegexParser, segmentHasEvidence } from "../regexParser";

/**
 * Corpus 2026-09-30: the generic reader turned tour-operator invoices and
 * Emirates/Lufthansa mails into plausible wrong flights — "WHO→WHO", a
 * return leg's number on the outbound leg, a round trip half routed.
 *
 * A leg has evidence when it carries a flight number OR a complete route —
 * and a route, once either end is there, must be complete: two different
 * known airports. A half route or the same airport twice is a wrong read,
 * not a partial one. No date is required: `parsers.text.test.ts` pins that a
 * printed number and route stand on their own, and a route-less number is
 * incomplete rather than wrong — the flight lookup fills the route in.
 *
 * A document of several legs is declined whole when any leg lacks evidence,
 * when routed and route-less legs are mixed, or when one flight number sits
 * on two different routes: the last two are how a positional pairing of
 * numbers to routes shows that it went wrong.
 *
 * A lone flight number with NO route is still handed on to the #291 gate
 * (`email.loneFlightNumber.test.ts`), which reads the mail's text.
 */
describe("the generic flight reader earns its result", () => {
  it("returns a complete single flight", async () => {
    const text =
      "Flug: LH 400\nVon: Frankfurt (FRA)\nNach: New York (JFK)\nAbflug: 12.03.2027 10:15\nAnkunft: 12.03.2027 12:55";
    const flights = await getRegexParser().parseEmail("Ihre Buchung", text);
    expect(flights).toHaveLength(1);
    expect(flights[0].flightNumber).toBe("LH400");
  });

  it("declines a leg whose two ends are the same airport", () => {
    expect(
      segmentHasEvidence({
        flightNumber: "QR70",
        departureCode: "DOH",
        arrivalCode: "DOH",
        departureTime: "2027-03-12T10:15:00",
      } as never)
    ).toBe(false);
  });

  it("accepts a flight number and a complete route without a date", () => {
    // Replaces "declines a leg without a date" (2026-09-30 ruling): the date is
    // not what makes a leg a flight, and requiring one broke the deliberate
    // invariant in parsers.text.test.ts.
    expect(
      segmentHasEvidence({
        flightNumber: "QR70",
        departureCode: "FRA",
        arrivalCode: "DOH",
      } as never)
    ).toBe(true);
  });

  it("accepts a complete route without a flight number", () => {
    expect(segmentHasEvidence({ departureCode: "FRA", arrivalCode: "JFK" } as never)).toBe(true);
  });

  it("accepts a flight number without any route — the lookup completes it", () => {
    expect(segmentHasEvidence({ flightNumber: "QR70" } as never)).toBe(true);
  });

  it("declines the same airport twice, whatever the letter case", () => {
    expect(
      segmentHasEvidence({
        flightNumber: "QR70",
        departureCode: "doh",
        arrivalCode: "DOH",
      } as never)
    ).toBe(false);
  });

  it("declines a route with an end that is no known airport", () => {
    expect(
      segmentHasEvidence({
        flightNumber: "QR70",
        departureCode: "FRA",
        arrivalCode: "QQQ",
      } as never)
    ).toBe(false);
  });

  it("declines a leg with exactly one route end", () => {
    // A "half route" is incomplete in a way "no route at all" is not — see
    // the doc comment above. Carries a valid date so the reason it fails is
    // unambiguously the route shape, not the date.
    expect(
      segmentHasEvidence({
        flightNumber: "QR70",
        departureCode: "FRA",
        departureTime: "2027-03-12T10:15:00",
      } as never)
    ).toBe(false);
  });

  it("declines the whole document when one of several legs is incomplete", async () => {
    // Two flight numbers, the second with only a departure printed: returning
    // one leg would present a round trip as a one-way flight. (The fixture
    // used to print no parseable route at all; under the 2026-09-30 rule two
    // route-less numbers are two lookup-able legs, so the incomplete leg is
    // now a half route.)
    const text = [
      "Flug: QR 070",
      "Von: Frankfurt (FRA)",
      "Nach: Doha (DOH)",
      "Abflug: 15.11.2027 10:35",
      "Flug: QR 071",
      "Von: Doha (DOH)",
      "Abflug: 22.11.2027 08:10",
    ].join("\n");
    expect(await getRegexParser().parseEmail("Rechnung", text)).toEqual([]);
  });

  it("does not pin the one route it found on one of several numbers", async () => {
    // The Emirates shape: the outbound leg's route is printed, the onward
    // legs' are not. With fewer routes than flight numbers the positional
    // pairing cannot say which number a route belongs to, so every leg comes
    // out route-less — uniform, and completed by the flight lookup — instead
    // of the first number taking a route that may be someone else's (round 2,
    // ruling A; round 1 declined the whole document here).
    const text = [
      "Flug: QR 070",
      "Von: Frankfurt (FRA)",
      "Nach: Doha (DOH)",
      "Abflug: 15.11.2027 10:35",
      "Ankunft: 15.11.2027 17:05",
      "Flug: QR 908",
      "Abflug: 16.11.2027 02:15",
      "Ankunft: 16.11.2027 22:40",
    ].join("\n");
    const flights = await getRegexParser().parseEmail("Ihre Reise", text);
    expect(
      flights.map((f) => [f.flightNumber, f.departureCode ?? null, f.arrivalCode ?? null])
    ).toEqual([
      ["QR070", null, null],
      ["QR908", null, null],
    ]);
  });

  it("still declines mixed routed and route-less legs, whichever path made them", () => {
    expect(
      documentDefect([
        { flightNumber: "QR70", departureCode: "FRA", arrivalCode: "DOH" },
        { flightNumber: "QR908" },
      ] as never)
    ).toBe("mixed_routed_and_routeless_legs");
  });

  it("declines legs whose dates run backwards", async () => {
    // The 1C895383 invoice shape (invented here): a route-only round trip
    // whose return leg took a date from elsewhere in the document, eight
    // months before the outbound. Legs are listed in travel order; a return
    // that departs before the outbound is a mis-paired date.
    const text = [
      "Von: Frankfurt (FRA)",
      "Nach: Doha (DOH)",
      "Abflug: 15.11.2027 10:35",
      "Ankunft: 15.11.2027 17:05",
      "Von: Doha (DOH)",
      "Nach: Frankfurt (FRA)",
      "Abflug: 28.03.2027 02:46",
      "Ankunft: 28.03.2027 07:10",
    ].join("\n");
    expect(await getRegexParser().parseEmail("Rechnung", text)).toEqual([]);
  });

  it("does not count an undated leg against the order", () => {
    expect(
      documentDefect([
        { flightNumber: "QR70", departureTime: "2027-11-15T10:35" },
        { flightNumber: "QR908" },
        { flightNumber: "QR909", departureTime: "2027-11-15T10:35" },
      ] as never)
    ).toBeNull();
  });

  it("declines a document that puts one flight number on two different routes", async () => {
    // The Lufthansa-connection shape: one number found, two routes found, and
    // the pairing hands the return leg's number to the outbound leg too.
    const text = [
      "Flug: LH 2317",
      "Von: München (MUC)",
      "Nach: Luxemburg (LUX)",
      "Abflug: 18.11.2027 07:00",
      "Ankunft: 18.11.2027 08:05",
      "Von: Luxemburg (LUX)",
      "Nach: München (MUC)",
      "Abflug: 20.11.2027 18:00",
      "Ankunft: 20.11.2027 19:05",
    ].join("\n");
    expect(await getRegexParser().parseEmail("Ihre Reise", text)).toEqual([]);
  });
});
