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
    const flights = await parser.parseEmail(
      "Ihr Flug mit Lufthansa",
      "Flug: LH117\nMünchen (MUC) nach Frankfurt (FRA)\nAbflug: 09:55",
      undefined
    );

    expect(flights.map((f) => f.flightNumber)).toContain("LH117");
  });
});
