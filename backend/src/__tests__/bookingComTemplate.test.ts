import fs from "fs";
import path from "path";
import { extractEmailFromFile } from "../services/emailExtractor";
import {
  isBookingComConfirmation,
  parseBookingComEmail,
  type ParsedLodgingBooking,
} from "../services/lodging/bookingComTemplate";

// The owner's REAL booking confirmations. Gitignored, present only on his
// machine — the suite skips itself everywhere else so CI stays green. We assert
// on EXTRACTED VALUES only; no sample content is ever printed or logged.
const SAMPLE_DIR = path.resolve(__dirname, "../../..", "test-samples", "Hotel Buchungen");
const hasSamples = fs.existsSync(SAMPLE_DIR);
const describeSamples = hasSamples ? describe : describe.skip;

/** Sample filenames carry emoji + umlauts; match on a stable substring instead. */
function loadSample(nameFragment: string): { subject: string; text: string } {
  const file = fs
    .readdirSync(SAMPLE_DIR)
    .find((f) => f.includes(nameFragment) && f.endsWith(".msg"));
  if (!file) throw new Error(`No sample matching "${nameFragment}"`);
  const buffer = fs.readFileSync(path.join(SAMPLE_DIR, file));
  const extracted = extractEmailFromFile(buffer, file);
  return { subject: extracted.subject, text: extracted.text };
}

function parseSample(nameFragment: string): ParsedLodgingBooking {
  const { subject, text } = loadSample(nameFragment);
  const parsed = parseBookingComEmail(subject, text);
  if (!parsed) throw new Error(`Template parser returned null for "${nameFragment}"`);
  return parsed;
}

describeSamples("Booking.com template parser (real samples)", () => {
  it("recognises a Booking.com confirmation and rejects a direct hotel booking", () => {
    const booking = loadSample("Bastion");
    expect(isBookingComConfirmation(booking.subject, booking.text)).toBe(true);

    const direct = loadSample("Novina");
    expect(isBookingComConfirmation(direct.subject, direct.text)).toBe(false);
    expect(parseBookingComEmail(direct.subject, direct.text)).toBeNull();
  });

  it("parses the Bastion Hotel Zoetermeer confirmation (3 nights, NL postcode)", () => {
    const r = parseSample("Bastion");
    expect(r.hotelName).toBe("Bastion Hotel Zoetermeer");
    expect(r.confirmationNumber).toBe("6546766578");
    expect(r.checkIn).toBe("2026-06-04");
    expect(r.checkOut).toBe("2026-06-07");
    expect(r.nights).toBe(3);
    expect(r.roomCategory).toBe("Deluxe Zimmer mit Kingsize-Bett");
    expect(r.address).toBe("Zilverstraat 6");
    expect(r.postcode).toBe("2718 RL");
    expect(r.city).toBe("Zoetermeer");
    expect(r.country).toBe("Niederlande");
    expect(r.totalPrice).toBeCloseTo(451.7, 2);
    expect(r.currency).toBe("EUR");
    expect(r.missing).toEqual([]);
  });

  it("parses the Engimatt confirmation (1 night, CHF, district in the address)", () => {
    const r = parseSample("Engimatt");
    expect(r.hotelName).toBe("Engimatt City & Garden Hotel");
    expect(r.confirmationNumber).toBe("5980532080");
    expect(r.checkIn).toBe("2026-06-30");
    expect(r.checkOut).toBe("2026-07-01");
    expect(r.nights).toBe(1);
    expect(r.roomCategory).toBe("Comfort Doppelzimmer mit Balkon");
    expect(r.address).toBe("Engimattstrasse 14, Enge");
    expect(r.postcode).toBe("8002");
    expect(r.city).toBe("Zürich");
    expect(r.country).toBe("Schweiz");
    expect(r.totalPrice).toBeCloseTo(292.83, 2);
    expect(r.currency).toBe("CHF");
  });

  it("parses the Hotel Stiegler confirmation (AT)", () => {
    const r = parseSample("Stiegler");
    expect(r.hotelName).toBe("Hotel Stiegler Bed & Breakfast");
    expect(r.confirmationNumber).toBe("5803862656");
    expect(r.checkIn).toBe("2026-07-19");
    expect(r.checkOut).toBe("2026-07-20");
    expect(r.nights).toBe(1);
    expect(r.roomCategory).toBe("Standard Doppelzimmer");
    expect(r.address).toBe("13 Leidern");
    expect(r.postcode).toBe("4850");
    expect(r.city).toBe("Timelkam");
    expect(r.country).toBe("Österreich");
    expect(r.totalPrice).toBeCloseTo(103.2, 2);
    expect(r.currency).toBe("EUR");
  });

  it("parses the NH Ludwigsburg confirmation (DE)", () => {
    const r = parseSample("NH Ludwigsburg");
    expect(r.hotelName).toBe("NH Ludwigsburg");
    expect(r.confirmationNumber).toBe("5087376273");
    expect(r.checkIn).toBe("2026-03-30");
    expect(r.checkOut).toBe("2026-03-31");
    expect(r.nights).toBe(1);
    expect(r.roomCategory).toBe("Standard Doppel- oder Zweibettzimmer");
    expect(r.address).toBe("Pflugfelder Straße 36");
    expect(r.postcode).toBe("71636");
    expect(r.city).toBe("Ludwigsburg");
    expect(r.country).toBe("Deutschland");
    expect(r.totalPrice).toBeCloseTo(98.1, 2);
  });

  it("parses the Novotel Suites Berlin confirmation (2 nights, district in the address)", () => {
    const r = parseSample("Novotel");
    expect(r.hotelName).toBe("Novotel Suites Berlin City Potsdamer Platz");
    expect(r.confirmationNumber).toBe("5967563369");
    expect(r.checkIn).toBe("2026-04-22");
    expect(r.checkOut).toBe("2026-04-24");
    expect(r.nights).toBe(2);
    expect(r.roomCategory).toBe("Standard Suite mit 1 Doppelbett und 1 Sofa");
    expect(r.address).toBe("Anhalter Str. 2, Friedrichshain-Kreuzberg");
    expect(r.postcode).toBe("10963");
    expect(r.city).toBe("Berlin");
    expect(r.totalPrice).toBeCloseTo(385.07, 2);
  });

  it("parses the Vienna House confirmation (whole-euro total, no decimals)", () => {
    const r = parseSample("Vienna House");
    expect(r.hotelName).toBe("Vienna House Easy by Wyndham Landsberg");
    expect(r.confirmationNumber).toBe("6220453895");
    expect(r.checkIn).toBe("2025-12-03");
    expect(r.checkOut).toBe("2025-12-04");
    expect(r.nights).toBe(1);
    expect(r.roomCategory).toBe("Comfort Zimmer");
    expect(r.city).toBe("Landsberg am Lech");
    expect(r.totalPrice).toBeCloseTo(112, 2);
    expect(r.currency).toBe("EUR");
  });
});

// These run everywhere — they use synthetic text, not the private samples.
describe("Booking.com template parser (synthetic)", () => {
  const synthetic = [
    "<https://booking.com> \t Bestätigungsnummer: 1234567890",
    "Buchungsinformationen",
    "Anreise\t Montag, 5. Januar 2026 (ab 15:00)\t",
    "Abreise\t Mittwoch, 7. Januar 2026 (bis 11:00)\t",
    "Ihre Buchung\t 2 Nächte, Superior Zimmer\t",
    "Lage\t Musterweg 1, 12345 Musterstadt, Deutschland",
    "Preisangaben",
    "Gesamtpreis",
    "€ 1.234,50",
    "",
  ].join("\n");

  it("parses a synthetic confirmation including a thousands separator", () => {
    const r = parseBookingComEmail("Ihre Buchung ist bestätigt: Musterhotel", synthetic);
    expect(r?.hotelName).toBe("Musterhotel");
    expect(r?.checkIn).toBe("2026-01-05");
    expect(r?.checkOut).toBe("2026-01-07");
    expect(r?.nights).toBe(2);
    expect(r?.totalPrice).toBeCloseTo(1234.5, 2);
    expect(r?.currency).toBe("EUR");
  });

  it("returns null for text that is not a Booking.com confirmation", () => {
    expect(parseBookingComEmail("Rechnung", "Sehr geehrter Kunde, anbei Ihre Rechnung.")).toBeNull();
  });

  it("reports a missing total price instead of failing", () => {
    const withoutPrice = synthetic.replace("Gesamtpreis\n€ 1.234,50", "");
    const r = parseBookingComEmail("Ihre Buchung ist bestätigt: Musterhotel", withoutPrice);
    expect(r).not.toBeNull();
    expect(r?.totalPrice).toBeNull();
    expect(r?.missing).toContain("totalPrice");
  });
});
