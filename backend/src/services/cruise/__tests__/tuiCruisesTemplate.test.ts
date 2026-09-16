import {
  cabinTypeFromCategory,
  matchesTuiCruises,
  parseItinerary,
  parseTuiCruisesConfirmation,
  TUI_TEMPLATE_ID,
} from "../tuiCruisesTemplate";

/**
 * The fixtures below are INVENTED. The real confirmations this reader was
 * built against are the owner's own mail, kept out of the repository — they
 * carry names, addresses and birthdates. What is reproduced here is the
 * document's grammar, which is what the parser reads, and nothing that
 * identifies anyone.
 */

const SINGLE = `
TUI Cruises GmbH • Musterweg 1 • 20097 Hamburg
Mein Schiff 9\tIhr Schiff:
Ihre Reise: 7 Nächte - Testland und Beispielinseln - ab/bis Musterhafen
Ihr Reisedatum: 01.05. - 08.05.2027
www.meinschiff.com
Optionsbestätigung
Vorgang-Nr.: 1234567/2
Datum: 01.02.2026
1-2 01.05.2027 -
08.05.2027
Mein Schiff 9
Verandakabine (2er Belegung)
Deck 8 - Welle - Kabine 8042
Änderungen der Termine, Route, Tendern, Liegezeiten
vorbehalten
01.05.2027 Musterhafen - 02.05.2027 Seetag - 03.05.2027 Beispielstadt
- 04.05.2027 Baie-Comeau - 05.05.2027 Seetag - 06.05.2027 Testburg
(Nebenort) - 07.05.2027 Seetag - 08.05.2027 Musterhafen
Premium Alles Inklusive
PRO-Tarif
2 x Kreuzfahrtpreis 4.198,00 €\t2.099,00 €\t1-2
2 x Frühbucher -200,00 €\t-100,00 €\t1-2
`;

/** A back-to-back: one confirmation, two cabin blocks, one label line each. */
const BACK_TO_BACK = `
TUI Cruises GmbH • Musterweg 1 • 20097 Hamburg
Mein Schiff 2\tIhr Schiff:
Ihre Reise: 3 Nächte - Erste Etappe - ab/bis Musterhafen
2 Nächte - Zweite Etappe - ab/bis Musterhafen
Ihr Reisedatum: 01.06. - 06.06.2027
www.meinschiff.com
Vorgang-Nr.: 7654321/1
1-2 01.06.2027 -
04.06.2027
Mein Schiff 2
Innenkabine (2er Belegung)
Deck 3 - Tiefe - Kabine 3001
Änderungen der Termine, Route, Tendern, Liegezeiten
vorbehalten
01.06.2027 Musterhafen - 02.06.2027 Seetag - 03.06.2027 Beispielstadt
- 04.06.2027 Musterhafen
Premium Alles Inklusive
2 x Kreuzfahrtpreis 1.000,00 €\t500,00 €\t1-2

-- 1 of 4 --

Seite 2
Datum 01.02.2026
Vorgang 7654321/1
1-2 04.06.2027 -
06.06.2027
Mein Schiff 2
Innenkabine (2er Belegung)
Deck 3 - Tiefe - Kabine 3001
Änderungen der Termine, Route, Tendern, Liegezeiten
vorbehalten
04.06.2027 Musterhafen - 05.06.2027 Seetag - 06.06.2027 Musterhafen
Premium Alles Inklusive
2 x Kreuzfahrtpreis 600,00 €\t300,00 €\t1-2
`;

describe("TUI Cruises confirmation template", () => {
  it("recognises the issuer, and only the issuer", () => {
    expect(matchesTuiCruises(SINGLE)).toBe(true);
    // A mail that merely mentions the ship is not a confirmation, and reading
    // it with this grammar would produce a booking out of an advertisement.
    expect(matchesTuiCruises("Mein Schiff 4 ab 799 € — jetzt buchen!")).toBe(false);
  });

  it("reads every field of a single-cruise confirmation", () => {
    const [cruise, ...rest] = parseTuiCruisesConfirmation(SINGLE);
    expect(rest).toEqual([]);
    expect(cruise.shipName).toBe("Mein Schiff 9");
    expect(cruise.cruiseLine).toBe("TUI Cruises");
    expect(cruise.routeName).toBe("Testland und Beispielinseln");
    expect(cruise.startDate).toBe("2027-05-01");
    expect(cruise.endDate).toBe("2027-05-08");
    expect(cruise.departurePortName).toBe("Musterhafen");
    expect(cruise.arrivalPortName).toBe("Musterhafen");
    expect(cruise.cabinNumber).toBe("8042");
    expect(cruise.cabinType).toBe("balcony");
    expect(cruise.deck).toBe(8);
    expect(cruise.bookingReference).toBe("1234567");
    expect(cruise.price).toBe(4198);
    expect(cruise.currency).toBe("EUR");
    expect(cruise.parserTemplate).toBe(TUI_TEMPLATE_ID);
    expect(cruise.missing).toEqual([]);
  });

  it("keeps sea days apart from ports, per the three-state invariant", () => {
    const [cruise] = parseTuiCruisesConfirmation(SINGLE);
    expect(cruise.stops).toHaveLength(8);
    const seaDays = cruise.stops.filter((s) => s.isAtSea);
    expect(seaDays).toHaveLength(3);
    // A sea day carries no port name at all — not an empty one.
    for (const day of seaDays) expect(day.portName).toBeUndefined();
    expect(cruise.stops.map((s) => s.dayNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  // The chain is split on dates, not on hyphens: a port with a hyphen in its
  // name would otherwise be cut in half and counted as two stops.
  it("does not split a port name on its own hyphen", () => {
    const [cruise] = parseTuiCruisesConfirmation(SINGLE);
    expect(cruise.stops.map((s) => s.portName)).toContain("Baie-Comeau");
  });

  it("keeps a parenthesised qualifier with its port", () => {
    const [cruise] = parseTuiCruisesConfirmation(SINGLE);
    expect(cruise.stops.map((s) => s.portName)).toContain("Testburg (Nebenort)");
  });

  it("reads a back-to-back booking as two cruises, each with its own leg", () => {
    const cruises = parseTuiCruisesConfirmation(BACK_TO_BACK);
    expect(cruises).toHaveLength(2);

    expect(cruises[0].routeName).toBe("Erste Etappe");
    expect(cruises[0].startDate).toBe("2027-06-01");
    expect(cruises[0].endDate).toBe("2027-06-04");
    expect(cruises[0].price).toBe(1000);

    // The second leg's label has no "Ihre Reise:" prefix — requiring it left
    // this cruise routeless when the reader was first measured.
    expect(cruises[1].routeName).toBe("Zweite Etappe");
    expect(cruises[1].startDate).toBe("2027-06-04");
    expect(cruises[1].endDate).toBe("2027-06-06");
    // Each leg takes its OWN price, not the first one it can find.
    expect(cruises[1].price).toBe(600);
  });

  it("returns nothing for a document it does not recognise", () => {
    expect(parseTuiCruisesConfirmation("Ihre Buchung bei einer anderen Reederei")).toEqual([]);
  });

  it("returns nothing when the issuer matches but no segment can be read", () => {
    expect(parseTuiCruisesConfirmation("TUI Cruises GmbH\nDanke für Ihre Anfrage.")).toEqual([]);
  });

  describe("cabin category", () => {
    it.each([
      ["Innenkabine (2er Belegung)", "inside"],
      ["Verandakabine (2er Belegung)", "balcony"],
      ["Junior Suite Balkon (2er Belegung)", "suite"],
      ["Himmel & Meer Suite", "suite"],
      ["Außenkabine", "oceanview"],
    ])("reads %s as %s", (category, expected) => {
      expect(cabinTypeFromCategory(category)).toBe(expected);
    });

    // Abstention is a result: a category nobody taught it stays absent and is
    // named in `missing`, rather than defaulting to the commonest cabin.
    it("answers undefined for a category it does not know", () => {
      expect(cabinTypeFromCategory("Kabine")).toBeUndefined();
    });
  });

  it("names what it could not read instead of inventing it", () => {
    const withoutPrice = SINGLE.replace(/2 x Kreuzfahrtpreis.*\n/, "");
    const [cruise] = parseTuiCruisesConfirmation(withoutPrice);
    expect(cruise.price).toBeUndefined();
    expect(cruise.currency).toBeUndefined();
    expect(cruise.missing).toContain("price");
  });

  it("numbers stops from one and dates them", () => {
    const stops = parseItinerary("01.05.2027 Musterhafen - 02.05.2027 Seetag");
    expect(stops).toEqual([
      { dayNumber: 1, date: "2027-05-01", isAtSea: false, portName: "Musterhafen" },
      { dayNumber: 2, date: "2027-05-02", isAtSea: true },
    ]);
  });
});
