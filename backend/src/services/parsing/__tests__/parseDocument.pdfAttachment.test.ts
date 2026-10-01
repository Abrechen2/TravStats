/**
 * A flight mail whose itinerary exists only in its PDF attachment — Air
 * Berlin's "anbei erhalten Sie die Rechnung" mails (private mailbox,
 * 2026-10-01: about fifty, every one read as nothing). The PDF's text is
 * stubbed; every value is invented.
 */
const PDF_TEXT: Record<string, string> = {
  "itinerary.pdf": [
    "Air Berlin PLC & Co. Luftverkehrs KG",
    "Rechnung und Reisebestätigung",
    "Buchungsnummer \tQX7TST",
    "STRECKE \tDATUM \tFLUGZEITEN \tFLUG",
    "Munich - Hamburg \t21.04.2015 \t13:35 - 14:55 \tAB 5551",
  ].join("\n"),
  "voucher.pdf": "Ihr persönlicher Reisegutschein bei airberlin holidays\nGutschein Code",
  "rubbish.pdf": "%%unreadable%%",
};

jest.mock("../../pdfParser", () => ({
  extractTextFromPdf: jest.fn(async (buffer: Buffer) => {
    const name = buffer.toString("utf8");
    if (name === "rubbish.pdf") throw new Error("Invalid PDF: missing %PDF header");
    return PDF_TEXT[name] ?? "";
  }),
}));

import { parseDocument } from "../parseDocument";
import { templateRegistry } from "../../parsers/templates/registry";

const BODY = [
  "Sehr geehrte Damen und Herren,",
  "anbei erhalten Sie die Rechnung und die wichtigen Informationen zu Ihrer Buchung:",
  "Rechnungsnummer: 1500000001",
  "Ihr Service Team airberlin group",
].join("\n");

const pdf = (name: string) => ({
  filename: name,
  mediaType: "application/pdf",
  content: Buffer.from(name, "utf8"),
});

type FlightBody = { flights: Array<Record<string, unknown>>; parserUsed: string };

async function parse(attachments: ReturnType<typeof pdf>[]): Promise<FlightBody> {
  const outcome = await parseDocument({
    text: BODY,
    subject: "Ihre Buchungsbestätigung QX7TST",
    domain: "flight",
    source: "email",
    attachments,
  });
  return outcome.body as unknown as FlightBody;
}

describe("a flight mail whose itinerary is only in its PDF", () => {
  beforeAll(async () => {
    await templateRegistry.initialize();
  });

  it("reads the flight out of the attached invoice", async () => {
    const body = await parse([pdf("itinerary.pdf")]);
    expect(
      body.flights.map((f) => [f.flightNumber, f.departureCode, f.arrivalCode, f.departureTime])
    ).toEqual([["AB5551", "MUC", "HAM", "2015-04-21T13:35"]]);
  });

  it("skips a PDF it cannot open and a PDF that is no itinerary, and still finds the one that is", async () => {
    const body = await parse([pdf("rubbish.pdf"), pdf("voucher.pdf"), pdf("itinerary.pdf")]);
    expect(body.flights.map((f) => f.flightNumber)).toEqual(["AB5551"]);
  });

  it("answers nothing when no PDF holds an itinerary — the body named none either", async () => {
    const body = await parse([pdf("voucher.pdf")]);
    expect(body.flights).toEqual([]);
  });
});
