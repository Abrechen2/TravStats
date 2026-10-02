import { TemplateParser } from "../templateParser";
import { templateRegistry } from "../../templates/registry";

/**
 * Emirates confirmations in two layouts, after `cleanEmailBody`.
 *
 * Measured 2026-10-01 on a private mailbox: the 2014/2015 German mails
 * ("Buchungsbestätigung - <code>") came back as ONE leg without a route; the
 * 2018+ mails ("Ihre Buchung ist bestätigt") as two legs without routes whose
 * departure was the ARRIVAL time — the regex paired each number with the
 * first time after it, which in this layout is the landing. Every value below
 * is invented.
 */
const LAYOUT_2018 = [
  "Ihre Buchung ist bestätigt",
  "Das Emirates-Team",
  "Buchungsnummer",
  "QX7TST",
  "Hinflug",
  "Mittwoch 04. März 2026",
  "MUC DXB",
  "Ihr Emirates",
  "Skywards-Konto",
  "Mitgliedsnummer",
  "EK00999999999",
  "Ihr Reiseplan",
  "Abflug | München nach Dubai | Reisezeit: 5 Std. 50 Min.",
  "Start Ankunft",
  "MUC",
  "München DXB",
  "Dubai",
  "21:10",
  "Mittwoch",
  "04. März 26 05:20",
  "Donnerstag",
  "05. März 26",
  "Flug",
  "EK111",
  "Flugzeugtyp",
  "Airbus A380-800",
  "Ankunft | Dubai nach München | Reisezeit: 6 Std. 25 Min.",
  "Start Ankunft",
  "DXB",
  "Dubai MUC",
  "München",
  "15:05",
  "Montag",
  "16. Mrz. 26 19:25",
  "Montag",
  "16. Mrz. 26",
  "Flug",
  "EK112",
  "Alle Zeitangaben in Ortszeit",
  "Passagiere",
].join("\n");

const LAYOUT_2014 = [
  "Buchungsbestätigung",
  "Vielen Dank für Ihre Buchung auf Emirates.com.",
  "BOOKING REFERENCE",
  "QX7TSU",
  "Flüge",
  "HINFLUG 17-Feb-15 München, Deutschland nach Dubai, Vereinigte Arabische Emirate",
  "Flug",
  "Abflug / Ankunft",
  "EK0123",
  "Di 17-Feb-15 09:10 Franz Josef Strauß - Flughafen (MUC) 5Std. 55Min.",
  "0 Zwischenstopps Economy",
  "Airbus A380-800",
  "Di 17-Feb-15 18:05 Dubai - Internationaler Flughafen (DXB)",
  "RÜCKFLUG 03-Mrz-15 Dubai, Vereinigte Arabische Emirate nach München, Deutschland",
  "Flug",
  "EK0124",
  "So 03-Mrz-15 07:40 Dubai - Internationaler Flughafen (DXB) 6Std. 40Min.",
  "0 Zwischenstopps Economy",
  "So 03-Mrz-15 11:20 Franz Josef Strauß - Flughafen (MUC)",
  "Diese Buchung verwalten",
].join("\n");

const legs = (flights: Array<Record<string, unknown>>): unknown[][] =>
  flights.map((f) => [
    f.flightNumber,
    f.departureCode,
    f.arrivalCode,
    f.departureTime,
    f.arrivalTime,
  ]);

describe("the Emirates templates", () => {
  beforeAll(async () => {
    await templateRegistry.initialize();
  });

  it("reads the 2018+ layout: departure before arrival, the overnight landing on the next day", async () => {
    const r = await new TemplateParser().read(
      "Ihre Buchung ist bestätigt - QX7TST",
      LAYOUT_2018,
      ""
    );
    expect(legs(r.flights as never)).toEqual([
      ["EK111", "MUC", "DXB", "2026-03-04T21:10", "2026-03-05T05:20"],
      ["EK112", "DXB", "MUC", "2026-03-16T15:05", "2026-03-16T19:25"],
    ]);
    expect(r.flights.every((f) => f.pnr === "QX7TST")).toBe(true);
  });

  it("reads the 2014/2015 layout with its two-digit years and 'Mrz'", async () => {
    const r = await new TemplateParser().read("Buchungsbestätigung - QX7TSU", LAYOUT_2014, "");
    expect(legs(r.flights as never)).toEqual([
      ["EK0123", "MUC", "DXB", "2015-02-17T09:10", "2015-02-17T18:05"],
      ["EK0124", "DXB", "MUC", "2015-03-03T07:40", "2015-03-03T11:20"],
    ]);
    expect(r.flights.every((f) => f.pnr === "QX7TSU")).toBe(true);
  });

  it("answers 'no booking' for an award-miles receipt, whose only number is the member's", async () => {
    // Read before as a flight out of the member number printed beside it.
    const receipt = [
      "Mitgliedsnummer",
      "EK 999 888 777",
      "Buchungsnummer: QX7TSV",
      "Wir freuen uns, Ihre Prämienflugbuchung* bestätigen zu können. Insgesamt wurden 5,000 Skywards-Meilen von Ihrem Konto abgebucht**.",
      "Emirates Skywards",
    ].join("\n");
    const r = await new TemplateParser().read("Bestätigung der Prämienflugbuchung", receipt, "");
    expect(r).toEqual({ flights: [], nonBooking: true });
  });

  it("declines an Emirates newsletter", async () => {
    const newsletter = [
      "Entdecken Sie Dubai mit Emirates",
      "Flüge ab 499 EUR — jetzt buchen.",
      "Ihr Emirates Team",
    ].join("\n");
    const r = await new TemplateParser().read("Emirates Angebote", newsletter, "");
    expect(r).toEqual({ flights: [], nonBooking: false });
  });
});
