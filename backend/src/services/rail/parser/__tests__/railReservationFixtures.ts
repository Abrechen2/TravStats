/**
 * Synthetic DB seat reservations booked after the ticket (forgejo#203).
 *
 * HYPOTHESIS, every one of them: no real reservation-only document exists in
 * the repository or in the private corpus the ticket templates were measured
 * on. Each borrows a layout DB is KNOWN to print for tickets (`railFixtures.ts`)
 * and adds the wording a reservation is assumed to carry. All values are
 * invented; the stations are the generic ones the ticket fixtures already use.
 */

/** A reservation PDF in the 2024 column-wise extraction of the Online-Ticket table. */
export const DB_RESERVATION_2024 = `Sitzplatzreservierung
Die Reservierung gilt nur in Verbindung mit einer gültigen Fahrkarte.
Klasse 2. Klasse
Gebucht am 02.04.2026 um 18:20 Uhr.
Auftragsnummer: 310987654321
Ihre Reiseverbindung und Reservierung - Einfache Fahrt am 19.04.2026
Halt Datum Zeit Gleis Produkte Reservierung / Hinweise
Musterstadt Hbf
Beispielburg Hbf
19.04.
19.04.
ab 19:55
an 23:58
5
4
ICE 615 1 Sitzplatz, Wg. 12, Pl. 133, 1 Fenster, Großraum,
Res.-Nr. 800000000010
Wichtige Nutzungshinweise:
- Es gelten die Beförderungsbedingungen der DB AG, siehe www.bahn.de/agb.`;

/**
 * A reservation PDF in the row-wise layout, two trains of a longer journey —
 * the first only from an intermediate stop (a SUB-SECTION of the logged leg).
 */
export const DB_RESERVATION_ROWS = `Reservierung
DB Fernverkehr AG
Auftragsnummer: Q9R8ST
Diese Reservierung ist nur gültig in Verbindung mit einem gültigen Fahrschein.
Ihre Reiseverbindung und Reservierung Hinfahrt am 14.03.2026
Halt Datum Zeit Gleis Produkte Reservierung
Mittelhausen 14.03. ab 08:40 2
Beispielburg Hbf 14.03. an 09:55 7
ICE 1507 2 Sitzplätze, Wg. 7, Pl. 45 46, 1 Fenster, 1 Gang
Beispielburg Hbf 14.03. ab 10:20 3
Nordhafen Hbf 14.03. an 11:30 1
IC 2217 1 Sitzplatz, Wg. 4, Pl. 87, Tisch
Wichtige Nutzungshinweise:
- Es gelten die Beförderungsbedingungen der DB AG.`;

/** A reservation-only confirmation mail in the 2020s "Buchungsbestätigung" layout. */
export const DB_RESERVATION_MAIL = `Hier Ihre Buchungsbestätigung.
vielen Dank für Ihre Buchung bei der Deutschen Bahn.
Am 02.04.2026 um 18:20 Uhr wurde der Auftrag mit der
Auftragsnummer 410987654321 wie folgt gebucht:
Leistungen
Sitzplatzreservierung, 2. Klasse
von Musterstadt Hbf, 19.04.2026 19:55 Uhr
ICE 615
nach Beispielburg Hbf, 19.04.2026 23:58 Uhr
Wagen 12, Platz 133
Die Zahlung des Gesamtpreises dieser Reise in Höhe von 5,50 EUR wird
per PayPal durchgeführt.
DB Fernverkehr AG`;

/**
 * A TICKET mail that also books a seat — the everyday case. It sells a fare,
 * so it stays a booking: its rides are new journeys, not attachments.
 */
export const DB_TICKET_WITH_RESERVATION_MAIL = `Hier Ihre Buchungsbestätigung.
vielen Dank für Ihre Buchung bei der Deutschen Bahn.
Auftragsnummer 510987654321 wie folgt gebucht:
Leistungen
Flexpreis, 2. Klasse
Sitzplatzreservierung
von Musterstadt Hbf, 19.04.2026 19:55 Uhr
ICE 615
nach Beispielburg Hbf, 19.04.2026 23:58 Uhr
Die Zahlung des Gesamtpreises dieser Reise in Höhe von 96,10 EUR wird
per PayPal durchgeführt.
DB Fernverkehr AG`;
