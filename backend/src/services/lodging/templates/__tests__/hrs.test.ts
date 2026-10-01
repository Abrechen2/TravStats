import { LODGING_TEMPLATES } from "../builtins";
import { applyLodgingTemplate } from "../engine";
import type { LodgingTemplate } from "../types";

const hrs = (): LodgingTemplate => {
  const found = LODGING_TEMPLATES.find((t) => t.id === "lodging:hrs");
  if (!found) throw new Error("No template lodging:hrs");
  return found;
};

/**
 * HRS, the hotel portal. Its confirmations from 2009 to 2016 share one
 * layout: the hotel under "Ihr ausgewähltes Hotel", its address as one
 * pipe-separated line, and the stay as "Anreise / Abreise: Mo. dd.mm.yyyy -
 * Di. dd.mm.yyyy" — sometimes with the dates on the line BELOW the label.
 *
 * Measured 2026-10-01 on a private mailbox: about two hundred of these, every
 * one read as nothing on an instance without a model. Every value below is
 * invented; only the shape is the sender's.
 */
const subject =
  "Bestätigung Ihrer Hotel-Buchung - Musterhof (Deutschland), 08.03.16 - 10.03.16 | HRS Vorgangs-Nr.: 11122233";

function confirmation(opts: { datesBelowLabel?: boolean; secondRoom?: boolean } = {}): string {
  const dates = "Mo. 08.03.2016 - Do. 10.03.2016";
  const room = (n: number, price: string): string[] => [
    "Ihre Buchungsdaten\t ",
    `\t\t${n}. Standardzimmer : Flex Tarif (EZ) <https://www.hrs.de/images/flex.png> `,
    "Buchungsnummer: \t\t99988877\t ",
    "Anreisende Gäste: \t\tMUSTERMANN, Erika\t ",
    ...(opts.datesBelowLabel
      ? ["Anreise / Abreise: ", "", `\t${dates}`, ""]
      : [`Anreise / Abreise: \t\t${dates}\t `]),
    `Zimmer-​Gesamtpreis (inkl. Steuern): \t\t${price} EUR\t `,
  ];
  return [
    "Buchung\t \t",
    "Hallo Erika Mustermann,",
    "vielen Dank für Ihre Buchung. Das Hotel Musterhof <https://www.hrs.de/web3/showPage.do?hotelnumber=1> freut sich auf Sie.",
    "Ihr HRS Team\t \t",
    "Ihre Buchungsdaten",
    "HRS Vorgangsnummer: \t\t11122233\t ",
    "HRS Zugriffscode: \t\t01234\t ",
    "Buchungsdatum:\t \tDo. 01.01.2015 | MEZ\t ",
    // The real mails put one or two blank lines under the heading.
    "Ihr ausgewähltes Hotel",
    "",
    "",
    "Landhotel Musterhof <https://www.hrs.de/web3/showPage.do?page=showHotelData&hotelnumber=1>",
    "Beispielweg 7 | 12345 Musterstadt | Musterkreis | Deutschland",
    "Telefon | Fax:\t \t0049123456 | 0049123457\t ",
    "Frühester Check-In (Ortszeit): \t\t14:00\t ",
    ...room(1, "198,00"),
    ...(opts.secondRoom ? room(2, "99,00") : []),
    "Zahlungsart: Sie zahlen direkt im Hotel\t ",
  ].join("\n");
}

describe("the HRS reader", () => {
  it("reads the hotel, its address, both dates and the booking's process number", () => {
    const r = applyLodgingTemplate(hrs(), subject, `${subject}\n\n${confirmation()}`);
    expect(r).not.toBeNull();
    expect(r?.hotelName).toBe("Landhotel Musterhof");
    expect(r?.address).toBe("Beispielweg 7");
    expect(r?.postcode).toBe("12345");
    expect(r?.city).toBe("Musterstadt");
    expect(r?.country).toBe("Deutschland");
    expect(r?.checkIn).toBe("2016-03-08");
    expect(r?.checkOut).toBe("2016-03-10");
    expect(r?.nights).toBe(2);
    expect(r?.confirmationNumber).toBe("11122233");
    expect(r?.totalPrice).toBeCloseTo(198, 2);
    expect(r?.currency).toBe("EUR");
    expect(r?.parserTemplate).toBe("hrs");
  });

  it("reads the dates when HRS puts them on the line below the label", () => {
    const r = applyLodgingTemplate(
      hrs(),
      subject,
      `${subject}\n\n${confirmation({ datesBelowLabel: true })}`
    );
    expect(r?.checkIn).toBe("2016-03-08");
    expect(r?.checkOut).toBe("2016-03-10");
  });

  it("names no total for a booking of two rooms — the line it would read is one room's", () => {
    const r = applyLodgingTemplate(
      hrs(),
      subject,
      `${subject}\n\n${confirmation({ secondRoom: true })}`
    );
    expect(r?.checkIn).toBe("2016-03-08");
    expect(r?.totalPrice).toBeNull();
  });

  it("declines an HRS newsletter — a sender is not a stay", () => {
    const newsletter = [
      "Ihre Vorteile als HRS Firmenkunde",
      "Buchen Sie jetzt Ihr Hotel für die Messe — bis zu 30 % günstiger.",
      "Anreise / Abreise frei wählbar. Ihr ausgewähltes Hotel wartet.",
    ].join("\n");
    expect(applyLodgingTemplate(hrs(), "HRS Newsletter", newsletter)).toBeNull();
  });

  it("does not claim another sender's confirmation", () => {
    const other = [
      "Ihre Reservierung im Hotel Beispiel",
      "Anreise / Abreise: Mo. 08.03.2016 - Do. 10.03.2016",
      "Vielen Dank für Ihre Buchung bei Beispielportal.",
    ].join("\n");
    expect(applyLodgingTemplate(hrs(), "Ihre Reservierung", other)).toBeNull();
  });
});
