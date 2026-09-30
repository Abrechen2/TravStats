import { getRegexParser, segmentHasEvidence } from "../regexParser";

/**
 * Corpus 2026-09-30: the generic reader turned tour-operator invoices and
 * Emirates mails into plausible wrong flights — "WHO→WHO", a date taken from
 * "ERSETZT RECHNUNG VOM", missing legs. A leg now needs a flight number, a
 * real date, and a route that is either fully present (two different known
 * airports) or fully absent — a half route or two matching airports is a
 * wrong read, not a partial one, and declines regardless of date.
 *
 * A lone flight number with NO route at all is a different, older case
 * (GitHub #291) and is deliberately not decided by `segmentHasEvidence`;
 * see `email.loneFlightNumber.test.ts` for that gate and
 * `RegexTextParser.withEvidence`'s doc comment for why.
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

  it("declines a leg without a date", () => {
    expect(
      segmentHasEvidence({
        flightNumber: "QR70",
        departureCode: "FRA",
        arrivalCode: "DOH",
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
    // Two flight numbers, only one route: returning one leg would present a
    // round trip as a one-way flight.
    const text = "Flug QR 070 Frankfurt (FRA) - Doha (DOH) 15.11.2027 10:35\nFlug QR 071\nRECHNUNG";
    expect(await getRegexParser().parseEmail("Rechnung", text)).toEqual([]);
  });
});
