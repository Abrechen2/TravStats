/**
 * Synthetic Sixt documents in the SHAPES measured on the owner's corpus
 * (spec 2026-10-01-rental-domain-design §1.4). Every value is invented —
 * stations, numbers, models, prices; no corpus value appears here.
 */

const ZWNJ = String.fromCharCode(0x200c);

/** Layout A (2024–2025): "Abholung: <station>" first, then its date line. */
export const SIXT_LAYOUT_A = [
  "Ihre Buchung bei SIXT Frankfurt Flughafen ist bestätigt: #1234567890",
  "",
  "Alle wichtigen Details anzeigen",
  `<https://click.example.invalid/x>  \tBuchung: \t${ZWNJ} 1234567890${ZWNJ}`,
  "Gute Entscheidung, Erika",
  "Ihre Buchung ist bestätigt",
  "<https://click.example.invalid/a> \tAbholung: Frankfurt Flughafen",
  "Montag, 06. Jul, 2026 um 09:15",
  "<https://click.example.invalid/b> \tRückgabe: Frankfurt Flughafen",
  "Mittwoch, 08. Jul, 2026 um 18:45",
  "Fahrzeugkategorie",
  "Testmobil Kompakt oder ähnlich",
  "<https://click.example.invalid/c> \tKein zusätzlicher Schutz enthalten",
  "<https://click.example.invalid/d> \tVollkaskoschutz bei Kollisionsschäden, Kratzern, Dellen und Diebstahl",
  "Schutzpaket buchen <https://click.example.invalid/e>",
  `${ZWNJ}Ihre Buchungsübersicht${ZWNJ}`,
  `<https://click.example.invalid/f> \t${ZWNJ}24/7 Pannenhilfe${ZWNJ}`,
  `<https://click.example.invalid/g> \t${ZWNJ}Unbegrenzte Kilometer${ZWNJ}`,
  "Gesamtsumme bei Abholung \t123,45 €",
  "Eine zusätzliche 300,00€ Kaution wird bei der Abholung auf Ihrer Karte blockiert.",
  "Ihr SIXT Team in Frankfurt Flughafen",
].join("\n");

/** Layout B (2026): the date line BEFORE "Abholung in <station>", prepaid, a country tag. */
export const SIXT_LAYOUT_B = [
  "Ihre Buchung bei SIXT Frankfurt Flughafen ist bestätigt: #2345678901",
  "",
  "Ihre Buchung ist bestätigt!",
  `Buchung: ${ZWNJ}2345678901${ZWNJ}`,
  "Donnerstag, 03. Sep, 2026 um 15:30",
  "Abholung in Frankfurt Flughafen",
  "Sonntag, 06. Sep, 2026 um 10:30",
  "Rückgabe in München Flughafen",
  "Fahrzeuggruppe",
  "Testmobil A, Testmobil B oder ähnlich",
  "Extras, die bereits in Ihrer Buchung enthalten sind",
  `<https://example.invalid/i.png> \t${ZWNJ}24/7 Pannenhilfe${ZWNJ}`,
  `<https://example.invalid/i.png> \t${ZWNJ}Unbegrenzte Kilometer${ZWNJ}`,
  `<https://example.invalid/i.png> \t${ZWNJ}Selbstbeteiligung bis 950 EUR bei Unfall oder Diebstahl${ZWNJ}`,
  "Informationen zur Zahlung",
  "Mietpreis im Voraus bezahlt \t1.234,50 €",
  "SIXT Frankfurt Flughafen Team",
  "|country:DE|language:de|name:Erika|emailName:Neo_Confirmation|",
].join("\n");

/** The final invoice PDF text (`RENTAL_INV`), French labels, one car. */
export const SIXT_INVOICE_ONE_CAR = [
  "RENTAL_INV",
  "Facture",
  "Groupe de véhicules : CDMR",
  "Res. no. : 1234567890",
  "CL No. : 9876543210",
  "Retrait",
  "Station : Frankfurt Flughafen",
  "Restitution",
  "Station : Frankfurt Flughafen",
  "06.07.2026 09:20",
  "08.07.2026 18:10",
  "Montant total brut 150,75 €",
  "Airport 08.07.2026 10000 10412 412 XX-TE 123 Opel Corsa 0 30.000,00 €\t18:10",
].join("\n");

/** A car swap: two vehicle rows whose km add up. Dutch labels. */
export const SIXT_INVOICE_SWAP = [
  "RENTAL_INV",
  "Factuur",
  "Res. nr.: 2345678901",
  "Contractnr.: 8765432109",
  "Station: Frankfurt Flughafen",
  "Station: München Flughafen",
  "03.09.2026 15:40",
  "06.09.2026 10:05",
  "Totaal brutobedrag 1.300,00 €",
  "Flughafen 03.09.2026 500 500 0 AB-12-C Peugeot 208 0 20.000,00 €\t15:50",
  "Flughafen 06.09.2026 2000 2300 300 CD-34-E Volvo XC40 0 40.000,00 €\t10:05",
].join("\n");
