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

/**
 * Sample filenames carry emoji + umlauts; match on a stable substring instead.
 *
 * The fragment must identify exactly ONE file. `.find()` used to take whichever
 * matched first, so when the owner dropped 88 more confirmations into the
 * folder on 2026-08-13, "Novotel" silently started resolving to a different
 * hotel and a passing assertion turned into a failing one about the wrong mail.
 * An ambiguous fragment is a broken test, not a coin toss — say so.
 */
function loadSample(nameFragment: string): { subject: string; text: string } {
  const matches = fs
    .readdirSync(SAMPLE_DIR)
    .filter((f) => f.includes(nameFragment) && f.endsWith(".msg"));
  if (matches.length > 1) {
    throw new Error(
      `Fragment "${nameFragment}" matches ${matches.length} samples — make it unique.`,
    );
  }
  const file = matches[0];
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

    const direct = loadSample("Buchungsbestätigung _Novina");
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
    const r = parseSample("Novotel Suites Berlin");
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

  // Booking.com sends TWO layouts. The cases above are the inline one, where
  // the label and its value share a line ("Anreise\tMittwoch, …"). This one is
  // the stacked layout: the label sits alone on its line and the value follows
  // on the next. 22 of the owner's 95 samples arrived that way and every single
  // one fell through to the LLM (measured 2026-08-13) because `findValue` only
  // ever looked at the label's own line.
  it("parses the Hotel Alzinn confirmation (stacked label/value layout)", () => {
    const r = parseSample("Alzinn");
    expect(r.hotelName).toBe("Hotel Alzinn");
    expect(r.confirmationNumber).toBe("4914064941");
    expect(r.checkIn).toBe("2024-06-26");
    expect(r.checkOut).toBe("2024-06-28");
    expect(r.nights).toBe(2);
    expect(r.totalPrice).toBeCloseTo(324, 2);
    expect(r.currency).toBe("EUR");
    // Luxembourg writes the postal code as "L-5836" and puts it AFTER the city,
    // so the city must not be read off the last-segment-before-country rule.
    expect(r.city).toBe("Luxemburg (Stadt)");
    expect(r.postcode).toBe("L-5836");
    expect(r.country).toBe("Luxemburg");
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

  const stacked = [
    "<https://booking.com> \t Bestätigungsnummer: 1234567890",
    "Buchungsinformationen",
    "Anreise",
    "Montag, 5. Januar 2026 (ab 15:00)",
    "Abreise",
    "Mittwoch, 7. Januar 2026 (bis 11:00)",
    "Ihre Buchung",
    "2 Nächte, Superior Zimmer",
    "Lage",
    "Musterweg 1, 12345 Musterstadt, Deutschland",
    "Preisangaben",
    "Gesamtpreis",
    "€ 1.234,50",
    "",
  ].join("\n");

  it("parses the stacked layout, where each value sits on the line below its label", () => {
    const r = parseBookingComEmail("Ihre Buchung ist bestätigt: Musterhotel", stacked);
    expect(r?.checkIn).toBe("2026-01-05");
    expect(r?.checkOut).toBe("2026-01-07");
    expect(r?.nights).toBe(2);
    expect(r?.roomCategory).toBe("Superior Zimmer");
    expect(r?.city).toBe("Musterstadt");
    expect(r?.totalPrice).toBeCloseTo(1234.5, 2);
  });

  it("does not read the NEXT label as a stacked value", () => {
    // A label with no value at all must stay null rather than swallow whatever
    // line follows it — otherwise "Anreise" would report "Abreise" as its date
    // and the booking would carry a nonsense field instead of an honest gap.
    const labelsOnly = [
      "<https://booking.com> \t Bestätigungsnummer: 1234567890",
      "Anreise",
      "Abreise",
      "Mittwoch, 7. Januar 2026 (bis 11:00)",
      "",
    ].join("\n");
    const r = parseBookingComEmail("Ihre Buchung ist bestätigt: Musterhotel", labelsOnly);
    expect(r).toBeNull(); // no check-in => the template declines, as it always has
  });

  it("accepts the short 'Preis' total label as well as 'Gesamtpreis'", () => {
    const shortLabel = stacked.replace("Gesamtpreis", "Preis");
    const r = parseBookingComEmail("Ihre Buchung ist bestätigt: Musterhotel", shortLabel);
    expect(r?.totalPrice).toBeCloseTo(1234.5, 2);
    expect(r?.missing).not.toContain("totalPrice");
  });

  it("still ignores the word Gesamtpreis inside cancellation prose", () => {
    const prose = stacked.replace(
      "Gesamtpreis\n€ 1.234,50",
      "Bei einer Stornierung zahlen Sie einen Betrag in Höhe des Gesamtpreises.\n€ 1.234,50",
    );
    const r = parseBookingComEmail("Ihre Buchung ist bestätigt: Musterhotel", prose);
    expect(r?.totalPrice).toBeNull();
  });

  it("reads a postcode that follows the city as its own segment", () => {
    const luxembourg = stacked.replace(
      "Musterweg 1, 12345 Musterstadt, Deutschland",
      "2, Rue Nicolas Wester, Luxemburg (Stadt), L-5836, Luxemburg",
    );
    const r = parseBookingComEmail("Ihre Buchung ist bestätigt: Musterhotel", luxembourg);
    expect(r?.address).toBe("2, Rue Nicolas Wester");
    expect(r?.city).toBe("Luxemburg (Stadt)");
    expect(r?.postcode).toBe("L-5836");
    expect(r?.country).toBe("Luxemburg");
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
