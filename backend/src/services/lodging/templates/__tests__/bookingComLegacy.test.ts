import { LODGING_TEMPLATES } from "../builtins";
import { applyLodgingTemplate } from "../engine";
import { parseLodgingBookingText } from "../../lodgingBookingParser";
import type { LodgingTemplate } from "../types";

jest.mock("../../../parsers/llmAvailability", () => ({
  isLlmAvailable: jest.fn(async () => false),
  recordLlmProbe: jest.fn(),
}));
jest.mock("../../../llm/llmGate", () => ({
  llmRefusalFor: jest.fn(async () => ({ kind: "disabled_by_admin", reason: "off in this test" })),
}));
jest.mock("../../../parserSettings", () => ({
  getParserOrder: jest.fn(async () => "template_first"),
}));

const legacy = (): LodgingTemplate => {
  const found = LODGING_TEMPLATES.find((t) => t.id === "lodging:bookingcom-legacy");
  if (!found) throw new Error("No template lodging:bookingcom-legacy");
  return found;
};

/**
 * Booking.com confirmations from 2008 to 2018 in the one-line layout —
 * "Anreise <tab> Sonntag, 7. Februar 2016 (nach 15:00)" — which the main
 * Booking.com reader declines. Measured 2026-10-01 on a private mailbox:
 * about thirty of these read as nothing. Every value below is invented.
 */
const LAYOUT_2012 = [
  "Ihre Reservierung im Hotel Musterhof",
  "Vielen Dank! Ihre Buchung ist nun bestätigt. \t",
  "Buchungsnummer\t 123456789\t ",
  "PIN-Code \t1234\t ",
  "Ihre Buchung:\t 2 Nächte, 1 Zimmer, 2 Personen \t",
  "Anreise:\t Sonntag, 7. Februar 2016 ( nach 15:00 )\t ",
  "Abreise:\t Dienstag, 9. Februar 2016 ( vor 12:00 )\t ",
  "Gesamtpreis\t € 158 \t",
  "\tHotel Musterhof <http://www.booking.com/hotel/de/musterhof.html> \t",
  "Adresse:\t Beispielweg 7, Altstadt",
  "Musterstadt, 12345",
  "Deutschland",
  "Sie können Ihre Buchung über Mein Booking.com selber ändern oder stornieren.",
].join("\n");

const LAYOUT_2016 = [
  "Ihre Buchung in der Unterkunft Hotel Beispiel",
  "PIN-Code: 1234 \t",
  "Vielen Dank! Ihre Reservierung ist nun bestätigt. \t",
  "Hotel Beispiel <https://www.booking.com/hotel/gb/beispiel.html?aid=1> \t",
  "1 Beispiel Road, Docklands, London, 12345, Vereinigtes Königreich - Wegbeschreibung anzeigen <http://www.booking.com/x>",
  "Ihre Buchung\t 2 Nächte, 1 Zimmer \t",
  "Anreise\t Mittwoch, 8. März 2017 (ab 14:00) \t",
  "Abreise\t Freitag, 10. März 2017 (bis 11:00) \t",
  "Gesamtpreis \t£199\t ",
  "Buchung stornieren <https://secure.booking.com/myreservations.de.html?bn=987654321&pincode=1234>",
].join("\n");

const read = (subject: string, body: string) =>
  applyLodgingTemplate(legacy(), subject, `${subject}\n${body}`);

describe("the Booking.com one-line-layout reader", () => {
  it("reads the 2008–2014 layout: name from the subject, both dates, the total, the city", () => {
    const [subject, ...rest] = LAYOUT_2012.split("\n");
    const r = read(subject, rest.join("\n"));
    expect(r).not.toBeNull();
    expect(r?.hotelName).toBe("Hotel Musterhof");
    expect(r?.checkIn).toBe("2016-02-07");
    expect(r?.checkOut).toBe("2016-02-09");
    expect(r?.nights).toBe(2);
    expect(r?.totalPrice).toBe(158);
    expect(r?.currency).toBe("EUR");
    expect(r?.city).toBe("Musterstadt");
    expect(r?.postcode).toBe("12345");
    expect(r?.confirmationNumber).toBe("123456789");
  });

  it("reads the 2015–2018 layout, the address on one line under the hotel's link", () => {
    const [subject, ...rest] = LAYOUT_2016.split("\n");
    const r = read(subject, rest.join("\n"));
    expect(r?.hotelName).toBe("Hotel Beispiel");
    expect(r?.checkIn).toBe("2017-03-08");
    expect(r?.checkOut).toBe("2017-03-10");
    expect(r?.totalPrice).toBe(199);
    expect(r?.currency).toBe("GBP");
    expect(r?.city).toBe("London");
    expect(r?.confirmationNumber).toBe("987654321");
  });

  it("reads the city when the mail's lines end in CRLF, as a real .msg's do", () => {
    const [subject, ...rest] = LAYOUT_2012.split("\n");
    const r = read(subject, rest.join("\r\n"));
    expect(r?.city).toBe("Musterstadt");
    expect(r?.postcode).toBe("12345");
    expect(r?.country).toBe("Deutschland");
  });

  it("reads a forwarded confirmation, its subject prefixed", () => {
    const [, ...rest] = LAYOUT_2012.split("\n");
    const r = read("WG: Ihre Reservierung im Hotel Musterhof", rest.join("\n"));
    expect(r?.hotelName).toBe("Hotel Musterhof");
  });

  it.each([
    ["an updated booking", "Ihre Buchung in der Unterkunft Hotel Beispiel wurde aktualisiert"],
    ["a changed booking", "Ihre geänderte Buchung in der Unterkunft Hotel Beispiel"],
    ["a cancellation", "Buchung storniert für die Unterkunft Hotel Beispiel"],
    ["a message from the property", "Sie haben eine neue Nachricht der Unterkunft Hotel Beispiel"],
  ])("declines %s — a change must not become a second stay", (_kind, subject) => {
    const [, ...rest] = LAYOUT_2016.split("\n");
    expect(read(subject, rest.join("\n"))).toBeNull();
  });

  it("declines a Booking.com newsletter", () => {
    const newsletter =
      "Wir vermissen Sie!\nEntdecken Sie Angebote auf Booking.com — Anreise flexibel.";
    expect(read("Wir vermissen Sie!", newsletter)).toBeNull();
  });

  it("is reached through the parser when the main Booking.com reader declines the mail", async () => {
    const result = await parseLodgingBookingText(LAYOUT_2012);
    expect(result.bookings.map((b) => [b.hotelName, b.checkIn, b.parserTemplate])).toEqual([
      ["Hotel Musterhof", "2016-02-07", "bookingcom-legacy"],
    ]);
  });
});
