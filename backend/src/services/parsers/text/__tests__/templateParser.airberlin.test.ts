import { TemplateParser } from "../templateParser";
import { templateRegistry } from "../../templates/registry";

/**
 * Air Berlin's PDF invoices ("Rechnung und Reisebestätigung"), as
 * `extractTextFromPdf` hands them over. The mail body names no flight at all
 * — "anbei erhalten Sie die Rechnung" — so these PDFs are the only place the
 * itinerary exists. Measured 2026-10-01 on a private mailbox: about fifty
 * such mails, every one read as nothing. Three table layouts over the years;
 * every value below is invented.
 */
const HEADER_2010 = [
  "Air Berlin PLC & Co. Luftverkehrs KG",
  "Rechnung und Reisebestätigung",
  "Buchungsdetails",
  "Buchungs/Rechnungsnummer 01234567 / 2",
  "Buchungsdatum 02.01.2010",
  "Hinflug 08.02.2010 Hinflug : MUENCHEN - HAMBURG",
  "Rückflug 11.02.2010 Rückflug : HAMBURG - MUENCHEN",
  "Fluginformationen",
].join("\n");

/** 2010–2011: codes, and a date WITHOUT its year — it is in the header. */
const LAYOUT_2010 = [
  HEADER_2010,
  "Strecke Datum Flugzeiten Flugnr Buchungsklasse Gepäck",
  "MUC - HAM 08.02 07:15 - 08:30 AB1111 M 20KG",
  "HAM - MUC 11.02. 19:05 - 20:20 AB1112, M 20KG",
  "Preisdetails",
].join("\n");

/** 2011–2013: names, the date with its year, tab-separated. */
const LAYOUT_2012 = [
  "Rechnung und Reisebestätigung",
  "Buchungsdetails",
  "Buchungscode \tQX7TST",
  "Fluginformationen",
  "STRECKE \tDATUM \tFLUGZEITEN \tFLUG \tTERMINAL",
  "Munich - Berlin - Tegel \t14.03.2012 09:10 - 10:15 \tAB2221,P \t1,1",
  // From 2013 the number's two parts sit in two cells: "AB <tab>6188".
  "Berlin - Tegel - Munich \t16.03.2012 \t17:20 - 18:30 \tAB \t2222,O",
  "Operated by Air Berlin",
  "Preisdetails",
  "Air Berlin PLC & Co. Luftverkehrs KG",
].join("\n");

/** 2015: the route on a line of its own, the fare before the date. */
const LAYOUT_2015 = [
  "Rechnung und Reisebestätigung",
  "Buchungsnummer \tQX7TSU",
  "Fluginformationen",
  "STRECKE \tTARIF \tDATUM \tFLUGZEITEN \tFLUG",
  "Munich - Dusseldorf",
  "Operated by Air Berlin",
  "FlyDeal - Economy \t17.06.2015 \t06:50 - 08:05 \tAB 3331",
  "Dusseldorf - Munich",
  "Operated by Air Berlin",
  "FlyDeal - Economy \t19.06.2015 \t18:10 - 19:20 \tAB 3332",
  "Bitte beachten Sie, dass alle Flugzeiten in dieser Bestätigung in der jeweiligen Ortszeit angegeben sind",
  "Preisdetails",
  "airberlin group",
].join("\n");

const legs = (flights: Array<Record<string, unknown>>): unknown[][] =>
  flights.map((f) => [
    f.flightNumber,
    f.departureCode,
    f.arrivalCode,
    f.departureTime,
    f.arrivalTime,
  ]);

describe("the Air Berlin template", () => {
  beforeAll(async () => {
    await templateRegistry.initialize();
  });

  const read = (text: string) =>
    new TemplateParser().read("Ihre Buchungsbestätigung", text, undefined, undefined, {
      requireWholeLegs: true,
    });

  it("reads the 2010 layout, taking each leg's year from the header line of its date", async () => {
    const r = await read(LAYOUT_2010);
    expect(legs(r.flights as never)).toEqual([
      ["AB1111", "MUC", "HAM", "2010-02-08T07:15", "2010-02-08T08:30"],
      ["AB1112", "HAM", "MUC", "2010-02-11T19:05", "2010-02-11T20:20"],
    ]);
  });

  it("reads the 2012 layout, where 'Berlin - Tegel' carries the separator inside its own name", async () => {
    const r = await read(LAYOUT_2012);
    expect(legs(r.flights as never)).toEqual([
      ["AB2221", "MUC", "TXL", "2012-03-14T09:10", "2012-03-14T10:15"],
      ["AB2222", "TXL", "MUC", "2012-03-16T17:20", "2012-03-16T18:30"],
    ]);
    expect(r.flights.every((f) => f.pnr === "QX7TST")).toBe(true);
  });

  it("reads the 2015 layout with the route above the fare line", async () => {
    const r = await read(LAYOUT_2015);
    expect(legs(r.flights as never)).toEqual([
      ["AB3331", "MUC", "DUS", "2015-06-17T06:50", "2015-06-17T08:05"],
      ["AB3332", "DUS", "MUC", "2015-06-19T18:10", "2015-06-19T19:20"],
    ]);
  });

  it("names no time for a 2010 leg whose date the header does not carry", async () => {
    // A connection a day later is not in the Hinflug/Rückflug lines; a year
    // guessed for it would be a flight in the wrong year. The leg is not
    // whole, so the reading is declined.
    const text = LAYOUT_2010.replace("HAM - MUC 11.02.", "HAM - MUC 12.02.");
    const r = await read(text);
    expect(r.flights).toEqual([]);
  });

  it("declines Air Berlin's travel voucher PDF, which names the airline and no flight", async () => {
    const voucher = [
      "Ihr persönlicher 50€ Reisegutschein für Ihre nächste Flug & Hotel Buchung bei airberlin holidays",
      "Ihr persönlicher Gutschein Code",
      "Wie löse ich meinen Gutschein ein?",
    ].join("\n");
    const r = await read(voucher);
    expect(r).toEqual({ flights: [], nonBooking: false });
  });
});
