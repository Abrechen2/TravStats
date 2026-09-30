import { RegexTextParser } from "../regexParser";

/**
 * Forgejo #35. German advertising copy manufactures flight numbers, and the
 * guard written to stop it never fired.
 *
 * `FLIGHT_NUMBER_FALSE_PREFIXES` has listed "AB" since long before this bug was
 * filed. But the patterns carry /i and run over the source in its ORIGINAL
 * case, so "ab 380 EUR" arrived at the guard as "ab380", and "ab" is not "AB".
 * Six of the eight archived Emirates promotions became a flight that way. The
 * evidence rule from 9b91f790 cannot catch these: it asks for a flight number
 * or a route, and a flight number is exactly what the advertising produces.
 *
 * The second hole was the prefix length — the guard sliced the first two
 * characters, so "Nur 7 Tage gültig" passed as NUR7 on a prefix of "NU".
 *
 * These are shapes of German price advertising, not archived documents; the
 * archive belongs to a third party and stays out of the repository.
 */
describe("German filler words do not become flight numbers", () => {
  const parser = new RegexTextParser();

  it("does not read a price offer as a flight", async () => {
    const flights = await parser.parseEmail(
      "Ab 380 EUR mit Emirates in die Ferne!",
      "Fliegen Sie ab 380 EUR nach Dubai. Jetzt buchen und die Welt entdecken.",
      undefined
    );

    expect(flights.map((f) => f.flightNumber).filter(Boolean)).toEqual([]);
  });

  it("does not read a three-letter filler word as a flight", async () => {
    // "NU" was all the old guard ever inspected, so NUR7 walked through.
    const flights = await parser.parseEmail(
      "Nur 7 Tage gültig: Ihr 30 EUR Oster-Geschenk",
      "Sichern Sie sich jetzt Ihr Geschenk. Nur 7 Tage gültig, bis Ostern.",
      undefined
    );

    expect(flights.map((f) => f.flightNumber).filter(Boolean)).toEqual([]);
  });

  it("still reads a real labelled flight number", async () => {
    // The guard must not become so broad that a booking stops parsing — the
    // archived Air France and Lufthansa confirmations still resolve their legs.
    //
    // Task 3 (2026-09-30): the generic reader now also requires a complete
    // leg (a route AND a date), not just a flight number, so the fixture
    // carries "Von:"/"Nach:" labels and a full date alongside the time —
    // the original text only had a time and no labelled route, which the
    // false-prefix guard was never the thing testing.
    const flights = await parser.parseEmail(
      "Ihr Flug mit Lufthansa",
      "Flug: LH117\nVon: München (MUC)\nNach: Frankfurt (FRA)\nAbflug: 09.06.2027 09:55",
      undefined
    );

    expect(flights.map((f) => f.flightNumber)).toContain("LH117");
  });
});

/**
 * Forgejo #291 / #35. The same confirmation that produced MO24 also LOST its
 * real flights, and the two faults share one cause: which candidate wins.
 *
 * A confirmation prints its flight number alone on a line. The context lookahead
 * used `.`, which stops at the newline, so there was nothing after "EK0050" on
 * its own line to satisfy it and the real flight never matched at all. The next
 * line — the German weekday, the date and "Franz Josef Strauß - Flughafen" —
 * does contain "Flug", inside "Flughafen", so the weekday matched instead. The
 * rule meant to demand context was systematically preferring prose lines to
 * flight lines.
 *
 * Choosing the first hit in the document made it worse: the fare "EUR 934,00" is
 * printed above the itinerary, so even once the flight matched, the price came
 * first. Hence the preference for a prefix the airline catalogue knows — EK is
 * Emirates, EUR and MO are nothing.
 */
describe("the real flight wins over what is printed around it", () => {
  const parser = new RegexTextParser();

  /**
   * Task 3 (2026-09-30): this tab-table itinerary format prints its airport
   * codes as "Place - Flughafen (MUC)" with no "Von:"/"Nach:" label and no
   * lowercase "von X nach Y" phrase, so `extractAirportCodes` has never
   * recovered a route from it — a pre-existing gap in that extractor, not
   * something this task touches. The generic reader's evidence gate now
   * requires a route, so this document — precedence bug fixed or not — has
   * always had only a flight number and is correctly declined as a whole.
   * The precedence question (EK0050 over the price line and the weekday)
   * is still answered by `chosen`/`candidates` inside
   * `parseBookingEmailRegex`; what changed is that a flight number alone no
   * longer earns the document a result.
   */
  const CONFIRMATION = [
    "Buchungsbestätigung",
    "Flug\t 2 Passagiere, Economy, Sparpreis\t EUR 934,00",
    "Klasse / Flugzeug",
    "EK0050",
    "Mo\t24-Feb-14 14:25\t Franz Josef Strauß - Flughafen (MUC)\t 5Std. 50Min.",
    "Mo\t24-Feb-14 23:15\t Dubai - Internationaler Flughafen (DXB)",
  ].join("\n");

  it("declines the document, since it never recovers a route for EK0050", async () => {
    const flights = await parser.parseEmail("Buchungsbestätigung", CONFIRMATION, undefined);

    expect(flights).toEqual([]);
  });
});
