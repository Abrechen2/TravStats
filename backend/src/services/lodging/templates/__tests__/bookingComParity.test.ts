import { parseBookingComEmail } from "./legacy/bookingCom";
import { applyV2LodgingTemplate } from "../v2Lodging";
import { snapshotTemplate } from "../../../parsers/templates/v2/__tests__/snapshotTemplates";

/**
 * Plan 2026-10-09 P4b: the Booking.com reader — two layouts, the address
 * split, the currency rules — became the template `lodging:booking.com`. Every
 * synthetic shape the reader's own suite (`src/__tests__/bookingComTemplate
 * .test.ts`) builds, read by the old reader and by the file, gives the same
 * stay field for field, or the same "no".
 */
const read = (subject: string, body: string) =>
  applyV2LodgingTemplate(snapshotTemplate("lodging:booking.com"), subject, body);

const INLINE = [
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

const STACKED = [
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

const LAGE = "Musterweg 1, 12345 Musterstadt, Deutschland";
const SUBJECT = "Ihre Buchung ist bestätigt: Musterhotel";

const variants: Array<[string, string, string]> = [
  ["inline", SUBJECT, INLINE],
  ["stacked", SUBJECT, STACKED],
  ["inline, CRLF", SUBJECT, INLINE.replace(/\n/g, "\r\n")],
  ...[
    "US$ 135.87",
    "EUR 1,234.50",
    "US$ 135,87",
    "NOK 3.380",
    "AUD 2.886",
    "S$ 1.324,90",
    "US$628,70",
    "TEL 1.234,50",
  ].map((line): [string, string, string] => [
    `total ${line}`,
    SUBJECT,
    STACKED.replace("€ 1.234,50", line),
  ]),
  ...[
    "122 Middle Road, Victoria, 188973 Singapur, Singapur",
    "Seestraße 1, BW 78467 Konstanz, Deutschland",
    "2, Rue Nicolas Wester, Luxemburg (Stadt), L-5836, Luxemburg",
    "4949 Regent Boulevard, Irving, TX 75063, USA",
    "123 Front Street West, Toronto, ON M5V 2T6, Kanada",
    "Via Roma 1, Centro Storico, IT 00186, Roma, Italien",
    "Lipová 12/3, Kroměříž, 767 01, Tschechische Republik",
    "West Corniche Road, Abu Dhabi, F869C3J, Vereinigte Arabische Emirate",
  ].map((lage): [string, string, string] => [
    `address ${lage}`,
    SUBJECT,
    STACKED.replace(LAGE, lage),
  ]),
  [
    "labels only",
    SUBJECT,
    [
      "<https://booking.com> \t Bestätigungsnummer: 1234567890",
      "Anreise",
      "Abreise",
      "Mittwoch, 7. Januar 2026 (bis 11:00)",
      "",
    ].join("\n"),
  ],
  ["short 'Preis' label", SUBJECT, STACKED.replace("Gesamtpreis", "Preis")],
  [
    "Gesamtpreis in prose",
    SUBJECT,
    STACKED.replace(
      "Gesamtpreis\n€ 1.234,50",
      "Bei einer Stornierung zahlen Sie einen Betrag in Höhe des Gesamtpreises.\n€ 1.234,50"
    ),
  ],
  [
    "changed booking",
    "Ihre geänderte Buchung in der Unterkunft Musterhotel",
    STACKED.replace("Bestätigungsnummer: 1234567890", "Reservierungsnummer\t 1234567890"),
  ],
  [
    "direct hotel booking",
    "Buchungsbestätigung Musterhotel",
    STACKED.replace(
      "<https://booking.com> \t Bestätigungsnummer: 1234567890",
      "Buchungsnummer: 1234567890"
    ),
  ],
  [
    "dates without the ordinal dot",
    SUBJECT,
    STACKED.replace(
      "Montag, 5. Januar 2026 (ab 15:00)",
      "Samstag, 26 November 2022 (15:00 - 00:00)"
    ).replace("Mittwoch, 7. Januar 2026 (bis 11:00)", "Sonntag, 27 November 2022 (bis 13:00)"),
  ],
  ["31 April", SUBJECT, STACKED.replace("Montag, 5. Januar 2026", "Montag, 31. April 2026")],
  ["no total", SUBJECT, INLINE.replace("Gesamtpreis\n€ 1.234,50", "")],
  ["no room line", SUBJECT, STACKED.replace("Ihre Buchung\n2 Nächte, Superior Zimmer\n", "")],
  ["not Booking.com", "Rechnung", "Sehr geehrter Kunde, anbei Ihre Rechnung."],
  [
    "name after the property link",
    "Ihre Buchung",
    STACKED.replace(
      "<https://booking.com> \t Bestätigungsnummer: 1234567890",
      "<https://www.booking.com/hotel/de/x.html> Bestätigungsnummer: 1234567890\n\nHaus Beispiel"
    ),
  ],
];

describe("Booking.com — legacy reader and v2 file agree", () => {
  it.each(variants)("%s", (_name, subject, body) => {
    expect(read(subject, body)).toEqual(parseBookingComEmail(subject, body));
  });
});
