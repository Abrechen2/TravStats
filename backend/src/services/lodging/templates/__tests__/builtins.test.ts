import fs from "fs";
import path from "path";
import { extractEmailFromFile } from "../../../emailExtractor";
import { LODGING_TEMPLATES } from "../builtins";
import { applyLodgingTemplate, parseEnglishDate, templateMatches } from "../engine";
import type { LodgingTemplate } from "../types";

const byId = (id: string): LodgingTemplate => {
  const found = LODGING_TEMPLATES.find((t) => t.id === id);
  if (!found) throw new Error(`No template ${id}`);
  return found;
};

/**
 * forgejo#122 / forgejo#124 phase 4 — the readers that took the lodging
 * corpus from 97 of 108 to 106 of 108 without an LLM in reach.
 *
 * The synthetic cases run everywhere; the sample-gated block below asserts on
 * the owner's real mails where they exist, and asserts on EXTRACTED VALUES
 * only — no sample content is ever printed.
 */
describe("the declarative lodging readers", () => {
  describe("dates", () => {
    it.each([
      ["November 25, 2022", undefined, "2022-11-25"],
      ["25 November 2022", undefined, "2022-11-25"],
      ["01, Oct. 2018", undefined, "2018-10-01"],
      ["Oct 01", 2018, "2018-10-01"],
      ["May 3, 2023", undefined, "2023-05-03"],
    ])("reads %s", (raw, year, expected) => {
      expect(parseEnglishDate(raw, year)).toBe(expected);
    });

    it("refuses a year-less date when no year is offered — it does not borrow this one", () => {
      // The flight side learned this the hard way (#285): a date without a
      // year, resolved against today, silently files a 2018 stay in 2026.
      expect(parseEnglishDate("Oct 01")).toBeNull();
    });

    it("refuses a day the calendar does not have", () => {
      expect(parseEnglishDate("November 31, 2022")).toBeNull();
    });
  });

  describe("KOA", () => {
    const mail = [
      "Canton KOA Holiday Reservation Confirmation #12874330",
      "Your reservation to stay at Canton KOA Holiday has been completed.",
      "Details:",
      "2 Adults, Motorhome25 ft.",
      "Your Campsite:",
      "Pull Thru, 50/30/20 Amps, Full Hookups",
      "RESERVED",
      "Friday, November 25, 2022 - Saturday, November 26, 2022 (1 Night)",
      "RESERVATION #",
      "12874330",
      "Dates\t Rates\t Nights\t Price",
      "11/25/2022 - 11/26/2022\t $47.87 / Night\t 1\t $47.87",
      "Estimated Total For Your Stay* \t$47.87 (USD)",
    ].join("\n");

    it("reads the campground, both dates, the money and what kind of place it is", () => {
      const r = applyLodgingTemplate(byId("lodging:koa"), mail.split("\n")[0], mail);
      expect(r).not.toBeNull();
      expect(r?.hotelName).toBe("Canton KOA Holiday");
      expect(r?.checkIn).toBe("2022-11-25");
      expect(r?.checkOut).toBe("2022-11-26");
      expect(r?.nights).toBe(1);
      expect(r?.totalPrice).toBeCloseTo(47.87, 2);
      expect(r?.pricePerNight).toBeCloseTo(47.87, 2);
      expect(r?.currency).toBe("USD");
      expect(r?.guests).toBe(2);
      // A campground imported as a hotel is what made every such night read
      // as a hotel night in the statistics.
      expect(r?.type).toBe("campsite");
      expect(r?.chainName).toBe("KOA");
    });

    it("declines a mail that mentions KOA but carries no stay", () => {
      const newsletter = [
        "KOA Reservation Confirmation tips for your next trip",
        "Kampgrounds of America has 500 locations.",
      ].join("\n");
      expect(applyLodgingTemplate(byId("lodging:koa"), "KOA news", newsletter)).toBeNull();
    });
  });

  describe("Hilton", () => {
    const mail = [
      "Your 01 Oct 2018 Confirmation #3451920609",
      "Hilton Garden Inn Dubai Al Mina",
      "Al Mina Road, Port Rashid, Dubai, AE",
      "Your Room Information: \tTWIN BEDS ROOM,",
      "Guests: \t2  Adults",
      "Check In:\t Oct 01 3:00 PM",
      "Check Out:\t Oct 07 12:00 PM",
      "Your Plan Information:",
      "Rate per  night :  \t304.58   AED",
      "Total for Stay : \t2,383.49   AED",
    ].join("\n");

    it("takes the year from the subject for a body that dates without one", () => {
      const r = applyLodgingTemplate(byId("lodging:hilton"), mail.split("\n")[0], mail);
      expect(r?.hotelName).toBe("Hilton Garden Inn Dubai Al Mina");
      expect(r?.checkIn).toBe("2018-10-01");
      expect(r?.checkOut).toBe("2018-10-07");
      expect(r?.nights).toBe(6);
      expect(r?.totalPrice).toBeCloseTo(2383.49, 2);
      expect(r?.pricePerNight).toBeCloseTo(304.58, 2);
      expect(r?.currency).toBe("AED");
      expect(r?.roomCategory).toBe("TWIN BEDS ROOM");
    });

    // Cold review, 2026-09-17: a stay over New Year, dated without years.
    // Both halves borrowed the subject's year, so the stay ended before it
    // began and came out as zero nights — proposed to the user as fact.
    it("carries the year-less checkout over New Year instead of ending before it began", () => {
      const overNewYear = mail
        .replace("Your 01 Oct 2018 Confirmation", "Your 30 Dec 2026 Confirmation")
        .replace("Check In:	 Oct 01 3:00 PM", "Check In:	 Dec 30 3:00 PM")
        .replace("Check Out:	 Oct 07 12:00 PM", "Check Out:	 Jan 02 12:00 PM");
      const r = applyLodgingTemplate(
        byId("lodging:hilton"),
        "Your 30 Dec 2026 Confirmation #3451920609",
        overNewYear
      );
      expect(r?.checkIn).toBe("2026-12-30");
      expect(r?.checkOut).toBe("2027-01-02");
      expect(r?.nights).toBe(3);
    });

    it("declines rather than guess a year, when the subject carries none", () => {
      const noYear = mail.replace("Your 01 Oct 2018 Confirmation", "Your Confirmation");
      expect(applyLodgingTemplate(byId("lodging:hilton"), "Your Confirmation", noYear)).toBeNull();
    });
  });

  describe("travelclick", () => {
    const mail = [
      "Thank you for your reservation at Armani Hotel Dubai! Reference Number 711754296",
      "Confirmation number : 711754296 <https://reservations.travelclick.com/73769?confirmid=711754296>",
      "Check in\t April 30, 2023",
      "Check out\t May 3, 2023",
      "Adults\t 2",
      "You reserved: Armani Fountain Suite with Balcony, Breakfast",
      "Total amount including all taxes and excluding Tourism Dirham Fee:\t AED 11,662.00",
    ].join("\n");

    it("reads the property out of the prose subject and the total out of the long label", () => {
      const r = applyLodgingTemplate(byId("lodging:travelclick"), mail.split("\n")[0], mail);
      expect(r?.hotelName).toBe("Armani Hotel Dubai");
      expect(r?.checkIn).toBe("2023-04-30");
      expect(r?.checkOut).toBe("2023-05-03");
      expect(r?.totalPrice).toBeCloseTo(11662, 2);
      expect(r?.currency).toBe("AED");
      expect(r?.confirmationNumber).toBe("711754296");
    });
  });

  // CHECK24 wears Booking.com's stacked layout and is not Booking.com: it
  // says "Buchungsnummer", the label that reader deliberately refuses. It was
  // the last mail in the owner's corpus that nothing could read.
  describe("CHECK24", () => {
    const mail = [
      'Buchungsbestätigung "Novina Sleep Inn Herzogenaurach" (260308233983)',
      "Novina Sleep Inn Herzogenaurach",
      "60 Erlanger Straße, 91074 Herzogenaurach, Deutschland <https://maps.google.com/?q=x>",
      "Buchungsinformationen",
      "Buchungsnummer",
      "260308233983 (gebucht am Mo. 9. März 2026)",
      "Anreise",
      "Di. 10. März 2026 (Check-in: 15:00 - 22:00 Uhr)",
      "Abreise",
      "Mi. 11. März 2026 (Check-out bis 11:00 Uhr)",
      "Anzahl der Gäste",
      "1 Erwachsener",
      "Zimmername",
      "Appartement",
      "Buchungspreis",
      "156,60 EUR",
      "Ihre Buchung wurde über CHECK24 gebucht.",
    ].join("\n");

    it("reads the stacked German labels, the price and the address", () => {
      const r = applyLodgingTemplate(byId("lodging:check24"), mail.split("\n")[0], mail);
      expect(r).not.toBeNull();
      expect(r?.hotelName).toBe("Novina Sleep Inn Herzogenaurach");
      expect(r?.checkIn).toBe("2026-03-10");
      expect(r?.checkOut).toBe("2026-03-11");
      expect(r?.nights).toBe(1);
      expect(r?.confirmationNumber).toBe("260308233983");
      expect(r?.totalPrice).toBeCloseTo(156.6, 2);
      expect(r?.currency).toBe("EUR");
      expect(r?.guests).toBe(1);
      expect(r?.city).toBe("Herzogenaurach");
      expect(r?.postcode).toBe("91074");
      expect(r?.country).toBe("Deutschland");
    });

    it("does not read a Booking.com confirmation, which has its own reader", () => {
      const bookingCom = mail.replace("CHECK24", "booking.com");
      expect(
        applyLodgingTemplate(byId("lodging:check24"), bookingCom.split("\n")[0], bookingCom)
      ).toBeNull();
    });
  });

  describe("the shape every reader keeps", () => {
    it("declines when a required field is missing, rather than proposing half a stay", () => {
      // A name and no dates is not a stay, and a proposal costs the user more
      // attention than reading nothing would.
      const datesGone = [
        "Canton KOA Holiday Reservation Confirmation #12874330",
        "Kampgrounds of America",
      ].join("\n");
      expect(
        applyLodgingTemplate(byId("lodging:koa"), datesGone.split("\n")[0], datesGone)
      ).toBeNull();
    });

    it("leaves a price without its currency out entirely", () => {
      const noCurrency = [
        "Canton KOA Holiday Reservation Confirmation #12874330",
        "RESERVED",
        "Friday, November 25, 2022 - Saturday, November 26, 2022 (1 Night)",
        "Estimated Total For Your Stay* \t47.87",
      ].join("\n");
      const r = applyLodgingTemplate(byId("lodging:koa"), noCurrency.split("\n")[0], noCurrency);
      expect(r).not.toBeNull();
      expect(r?.totalPrice).toBeNull();
      expect(r?.currency).toBeNull();
      expect(r?.missing).toContain("totalPrice");
    });

    it("matches on the markers AND one anchor, never on a marker alone", () => {
      const koa = byId("lodging:koa");
      expect(templateMatches(koa, "a mail that merely says koa")).toBe(false);
      expect(templateMatches(koa, "koa ... Reservation Confirmation")).toBe(true);
    });

    it("gives every built-in an id, a name, required fields and a way to match", () => {
      for (const t of LODGING_TEMPLATES) {
        expect(t.id.startsWith("lodging:")).toBe(true);
        expect(t.name.length).toBeGreaterThan(0);
        expect(t.match.markers.length + t.match.anchors.length).toBeGreaterThan(1);
        expect(t.required).toContain("checkIn");
        expect(t.required).toContain("checkOut");
      }
    });
  });
});

const SAMPLE_DIR = path.resolve(__dirname, "../../../../../..", "test-samples", "Hotel Buchungen");
const describeSamples = fs.existsSync(SAMPLE_DIR) ? describe : describe.skip;

describeSamples("the declarative readers against the real corpus", () => {
  function parseSample(fragment: string): ReturnType<typeof applyLodgingTemplate> {
    const file = fs.readdirSync(SAMPLE_DIR).find((f) => f.includes(fragment) && f.endsWith(".msg"));
    if (!file) throw new Error(`No sample matching "${fragment}"`);
    const mail = extractEmailFromFile(fs.readFileSync(path.join(SAMPLE_DIR, file)), file);
    const subject = mail.subject ?? "";
    for (const template of LODGING_TEMPLATES) {
      const hit = applyLodgingTemplate(template, subject, `${subject}\n${mail.text ?? ""}`);
      if (hit) return hit;
    }
    return null;
  }

  it("reads the Canton KOA reservation", () => {
    const r = parseSample("Canton KOA");
    expect(r?.parserTemplate).toBe("koa");
    expect(r?.checkIn).toBe("2022-11-25");
    expect(r?.checkOut).toBe("2022-11-26");
    expect(r?.totalPrice).toBeCloseTo(47.87, 2);
    expect(r?.currency).toBe("USD");
    expect(r?.type).toBe("campsite");
  });

  it("reads the Hilton Garden Inn confirmation, year and all", () => {
    const r = parseSample("res.hilton.com");
    expect(r?.parserTemplate).toBe("hilton");
    expect(r?.checkIn).toBe("2018-10-01");
    expect(r?.checkOut).toBe("2018-10-07");
    expect(r?.nights).toBe(6);
    expect(r?.currency).toBe("AED");
  });

  it("reads the travelclick property", () => {
    const r = parseSample("2022-09-25_armanihotels");
    expect(r?.parserTemplate).toBe("travelclick");
    expect(r?.checkIn).toBe("2023-04-30");
    expect(r?.checkOut).toBe("2023-05-03");
    expect(r?.totalPrice).toBeCloseTo(11662, 2);
  });
});
