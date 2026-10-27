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

/**
 * The Dutch invoice PDF (Sixt B.V.) as pdf-parse prints it: each fee line is
 * the line total, then the unit price, the VAT code and the quantity —
 * "Schade- en diefstaldekking 21,00 €\t7,00 € A1\t3" (forgejo#280).
 */
export const SIXT_INVOICE_NL = [
  "Pagina1 van 2\t",
  "RENTAL_INV",
  "Factuurnr.:",
  "01.03.2026",
  "9000000000000001",
  "Factuur",
  "Voertuigcategorie: EDMR",
  "Res. nr.: 1111111111",
  "Contractnr.: 2222222222",
  "Ophaaldatum",
  "Station: Voorbeeldstad Flughafen",
  "Inlevering",
  "Station: Voorbeeldstad Flughafen",
  "26.02.2026 10:15",
  "01.03.2026 18:40",
  "Huurdagen 150,00 €\t50,00 € A1\t3",
  "Schade- en diefstaldekking 21,00 €\t7,00 € A1\t3",
  "Locatietoeslag 40,00 €\t40,00 € A1\t1",
  "211,00 €\tTotaal nettobedrag",
  "Totaal brutobedrag 255,31 €",
  "Openstaand bedrag 0,00 €",
  "-- 1 of 2 --",
  "Pagina2 van 2",
  "RENTAL_INV",
  "Voorbeeldstad",
  "Flughafen 01.03.2026 1000 1250 250 XX-00-Y Peugeot 208 102 30.000,00 €\t18:40",
  "Nettobedrag 211,00 € -211,00 € 0,00 €",
  "A1 Umsatzsteuer 21.00% 44,31 € -44,31 € 0,00 €",
  "255,31 € -255,31 € 0,00 €\tBrutobedrag",
  "1 Vooruitbetaald met factuur 9000000000000000 gedateerd 26.02.2026",
].join("\n");

/**
 * A cancelled prepaid booking: the mail (German) and its PDF, which is a
 * cancellation-fee invoice (`PREPAID_INV_V2`, French) — not a final invoice.
 */
export const SIXT_CANCELLATION_FEE_MAIL = [
  "Buchungsnummer: 4444444444",
  "Ihre Rechnung",
  "Ihre Buchung wurde storniert, daher müssen wir Ihnen eine Stornogebühr berechnen.",
  "Im Anhang finden Sie Ihre Rechnung.",
  "Belegnummer: \t9000000000000002",
  "Zahlbarer Rechnungsbetrag: \t58,50 EUR",
].join("\n");

export const SIXT_CANCELLATION_FEE_PDF = [
  "Page 1 sur 2\t",
  "PREPAID_INV_V2",
  "Facture",
  "Res. no. : 4444444444",
  "CL No. :",
  "Retrait",
  "10.05.2026 / 08:00 Station : Exempleville Aéroport",
  "Retour attendu",
  "12.05.2026 / 17:00 Station : Exempleville Aéroport",
  "Frais d'annulation de réservation 50,00 €\t1 50,00 € A1",
  "50,00 €\tMontant total net",
  "A1 Umsatzsteuer 17.00% 8,50 €",
  "Montant total brut 58,50 €",
].join("\n");

/**
 * Layout B from a Luxembourg station: a protection upsell block and an add-on
 * offer above the included extras, a deposit below the prepaid price.
 */
export const SIXT_LAYOUT_B_LU = [
  "Ihre Buchung ist bestätigt!",
  `Buchung: ${ZWNJ}7777777777${ZWNJ} \t`,
  "Mittwoch, 13. Mai, 2026 um 08:45 \t",
  "Abholung in Exempleville Flughafen \t",
  "Freitag, 15. Mai, 2026 um 19:15 \t",
  "Rückgabe in Exempleville Flughafen \t",
  "Fahrzeuggruppe \t",
  "Probeauto C oder ähnlich \t",
  "Ihr aktueller Schutz \t",
  "Ihr Schutz deckt nur Schäden und Diebstahl mit einer Selbstbeteiligung von 1.000€ ab. \t",
  "Empfohlener Fahrzeugschutz in Exempleville \t",
  "0 € Selbstbeteiligung \t",
  "Schutz bei Ansprüchen Dritter \t",
  "24/7 Pannenhilfe \t",
  "Zusatzfahrer \t",
  "Extras, die bereits in Ihrer Buchung enthalten sind \t",
  `${ZWNJ}24/7 Pannenhilfe${ZWNJ} \t`,
  `${ZWNJ}Haftpflichtversicherung${ZWNJ} \t`,
  `${ZWNJ}Unbegrenzte Kilometer${ZWNJ} \t`,
  `${ZWNJ}Selbstbeteiligung bis 1000 EUR bei Unfall oder Diebstahl${ZWNJ} \t`,
  "Informationen zur Zahlung \t",
  "Mietpreis im Voraus bezahlt \t150,00 € \t",
  "Bei der Abholung wird eine zusätzliche Kaution in Höhe von 300,00 € auf Ihrer Karte reserviert. \t",
  "|country:LU|language:de|name:Erika|emailName:confirm|",
].join("\n");
