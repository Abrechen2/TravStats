import { TemplateParser } from "../templateParser";
import { templateRegistry } from "../../templates/registry";

/**
 * Germanwings confirmations, 2007–2015, in the shape the parser sees them:
 * after `cleanEmailBody`, which collapses the mail's tabs to single spaces.
 *
 * Measured 2026-10-01 on a private mailbox: twenty-one of these, every one
 * read WRONG — the Lufthansa rule claimed them (their tax note names
 * "Lufthansa AirPlus"), declined, and the generic regex then took the VAT
 * number in the tax note as a flight. Every value below is invented.
 */
const TAX_NOTE =
  "Wenn diese Buchung mit einer AirPlus-Karte bezahlt wurde, berechtigt diese Rechnung nicht zum Vorsteuerabzug. Die Rechnung von Lufthansa AirPlus erfüllt diesen Zweck.\nUST-ID: DE 999 000 111";

const OLD_LAYOUT = [
  "Buchungsbestätigung und Rechnung",
  "vielen Dank, dass Sie sich für Germanwings entschieden haben.",
  "Ihre Flugbuchung",
  "Individueller Buchungscode (beim Check-In angeben)",
  "QX7TST Tag der Buchung: 02.01.2009 10:15",
  "Passagiere",
  "1. MR ERIKA MUSTERMANN",
  "Flugdaten (Zeiten sind Ortszeiten)",
  "Flug: 20.02.2009 | Flugnummer 4U 1234:",
  "Start Landung",
  "07:10 Dortmund 08:20 München",
  "Flug: 23.02.2009 | Flugnummer 4U 1235:",
  "Start Landung",
  "18:40 München 19:50 Dortmund",
  "Ihre Rechnungsdaten",
  "Reisepreis 99.00 €",
  TAX_NOTE,
].join("\n");

const NEW_LAYOUT = [
  "Individueller Buchungscode (beim Check-In angeben)",
  "QX7TSU Tag der Buchung: 05.01.2015 09:00",
  "Flug: 14.03.2015 | Flugnummer : 4U 5678 (SMART \\ N)",
  "Sitz(e): 12C (1)",
  "Start",
  "09:05 Berlin-Tegel Landung",
  "10:10 Köln-Bonn",
  "Flug: 14.03.2015 | Flugnummer : 4U 0987 (BASIC \\ N)",
  "Start",
  "13:30 Köln-Bonn",
  "Landung",
  "14:50 Mailand Malpensa",
  "Passagiere",
  "Germanwings GmbH",
  TAX_NOTE,
].join("\n");

describe("the Germanwings template", () => {
  beforeAll(async () => {
    await templateRegistry.initialize();
  });

  it("reads both legs of the 2007–2009 layout, with codes for the named airports", async () => {
    const r = await new TemplateParser().read(
      "Germanwings Buchungsbestätigung und Rechnung QX7TST",
      OLD_LAYOUT,
      ""
    );
    expect(r.nonBooking).toBe(false);
    expect(
      r.flights.map((f) => [
        f.flightNumber,
        f.departureCode,
        f.arrivalCode,
        f.departureTime,
        f.arrivalTime,
      ])
    ).toEqual([
      ["4U1234", "DTM", "MUC", "2009-02-20T07:10", "2009-02-20T08:20"],
      ["4U1235", "MUC", "DTM", "2009-02-23T18:40", "2009-02-23T19:50"],
    ]);
    expect(r.flights.every((f) => f.pnr === "QX7TST")).toBe(true);
    expect(r.flights[0].parserTemplate).toBe("4U");
  });

  it("reads the 2012–2015 layout, where 'Landung' sits beside or under the time", async () => {
    const r = await new TemplateParser().read(
      "Germanwings Buchungsbestätigung und Rechnung QX7TSU",
      NEW_LAYOUT,
      ""
    );
    expect(
      r.flights.map((f) => [
        f.flightNumber,
        f.departureCode,
        f.arrivalCode,
        f.departureTime,
        f.arrivalTime,
      ])
    ).toEqual([
      ["4U5678", "TXL", "CGN", "2015-03-14T09:05", "2015-03-14T10:10"],
      ["4U0987", "CGN", "MXP", "2015-03-14T13:30", "2015-03-14T14:50"],
    ]);
  });

  it("is reached although the Lufthansa rule claims the mail first", async () => {
    // Without the walk over every detected rule this mail ends at the LH
    // template, which declines — and the generic regex reads "DE 999".
    const r = await new TemplateParser().read("Germanwings Buchungsbestätigung", OLD_LAYOUT, "");
    expect(r.flights.map((f) => f.flightNumber)).not.toContain("DE999");
    expect(r.flights).toHaveLength(2);
  });

  it("declines a Germanwings newsletter — it names the airline and no flight", async () => {
    const newsletter = [
      "Germanwings Angebote im Februar",
      "Jetzt buchen: Flüge ab 29 € nach Mailand, Wien und Köln-Bonn.",
      "Ihr Germanwings Team",
    ].join("\n");
    const r = await new TemplateParser().read("Germanwings Newsletter", newsletter, "");
    expect(r).toEqual({ flights: [], nonBooking: false });
  });

  it("answers 'no booking' for a Germanwings cancellation, so nothing reads its flight lines", async () => {
    const cancellation = [
      "Ihre Buchung wurde storniert",
      "Individueller Buchungscode (beim Check-In angeben)",
      "QX7TST",
      "Flug: 20.02.2009 | Flugnummer 4U 1234:",
      "Start Landung",
      "07:10 Dortmund 08:20 München",
      "Germanwings GmbH",
    ].join("\n");
    const r = await new TemplateParser().read("Germanwings Stornierung QX7TST", cancellation, "");
    expect(r).toEqual({ flights: [], nonBooking: true });
  });
});
