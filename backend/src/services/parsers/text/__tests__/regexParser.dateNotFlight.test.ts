import { RegexTextParser } from "../regexParser";

/**
 * A travel agency's invoice subject reads "RECHNUNG <no> <file> NAME/FIRST
 * MR dd.mm.yyyy <code>" — the passenger's title, then the travel date. The
 * generic reader took "MR 24" for flight MR24 and filed it on that date.
 * Measured 2026-10-01 on a private mailbox: six such mails from one OTA, all
 * wrong. A "flight number" whose digits are the day of a dotted date is the
 * date. Every value below is invented.
 */
describe("the day of a dotted date is not a flight number", () => {
  const parser = new RegexTextParser();

  it("reads no flight out of 'MR 24.11.2031' in an invoice subject", async () => {
    const flights = await parser.parseEmail(
      "RECHNUNG 12345678 X11105/0001 MUSTERMANN/ERIKA MR 24.11.2031 QXABCD",
      "Sehr geehrte Damen und Herren,\nvielen Dank für Ihre Flugbuchung. Die Rechnung finden Sie im Anhang.",
      undefined
    );
    expect(flights.map((f) => f.flightNumber).filter(Boolean)).toEqual([]);
  });

  it("still reads a flight number that a date merely follows on the same line", async () => {
    const flights = await parser.parseEmail(
      "Ihre Flugbuchung",
      "Flug: LH 117 am 24.11.2031\nMünchen (MUC) nach Frankfurt (FRA)\nAbflug: 09:55",
      undefined
    );
    expect(flights.map((f) => f.flightNumber)).toContain("LH117");
  });
});
