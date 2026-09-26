/**
 * Synthetic rail tickets. Each follows the LAYOUT of a real DB generation,
 * with every value invented: no name, order number, payment reference or
 * station here comes from a real booking except the owner's own station pair,
 * which he released for tests. Where a layout itself is a guess, the fixture
 * says so.
 */

/** DB "Buchungsbestätigung", 2020s: one short-distance ride, no train number. */
export const DB_CONFIRMATION_SINGLE = `Hier Ihre Buchungsbestätigung.
Hallo Herr Max Mustermann,
vielen Dank für Ihre Buchung bei der Deutschen Bahn.
Am 14.06.2025 um 08:40 Uhr wurde der Auftrag mit der
Auftragsnummer 123456789012 wie folgt gebucht:
Leistungen
Einzelfahrkarte Kurzstrecke, 2. Klasse
von Neufahrn(b Freising), 14.06.2025 10:12 Uhr
nach München Flughafen Terminal, 14.06.2025 10:22 Uhr

-- 1 of 4 --

Die Zahlung des Gesamtpreises dieser Reise in Höhe von 3,20 EUR wird
per Apple Pay (Zahlungsreferenz: 9999999999) durchgeführt.
Diese E-Mail stellt keinen gültigen Fahrausweis und keine gültige
Rechnung dar.
Tipp: Zum Flughafen fahren auch die S 1 und der RE 22 im Takt.
Wir wünschen Ihnen eine gute Reise!
DB Fernverkehr AG
BAHN_2025-06-14_Hinfahrt_.ics
4 KB`;

/**
 * The same layout with a change of trains. HYPOTHESIS: that a long-distance
 * confirmation prints the train on its own line between "von" and "nach" is
 * not verified against a real mail — none was available.
 */
export const DB_CONFIRMATION_CHANGE = `Hier Ihre Buchungsbestätigung.
Hallo Frau Erika Musterfrau,
vielen Dank für Ihre Buchung bei der Deutschen Bahn.
Am 01.03.2026 um 18:02 Uhr wurde der Auftrag mit der
Auftragsnummer 210987654321 wie folgt gebucht:
Leistungen
Flexpreis, 1. Klasse
von Kiel Hbf, 14.03.2026 08:05 Uhr
RE 7
nach Hamburg Hbf, 14.03.2026 09:17 Uhr
von Hamburg Hbf, 14.03.2026 09:46 Uhr
ICE 1507
nach Bremen Hbf, 14.03.2026 10:43 Uhr
Die Zahlung des Gesamtpreises dieser Reise in Höhe von 1.084,50 EUR wird
per Kreditkarte durchgeführt.
DB Fernverkehr AG`;

/** Hin- and Rückfahrt sections in the 2020s layout, no trains printed. */
export const DB_CONFIRMATION_RETURN = `Hier Ihre Buchungsbestätigung.
vielen Dank für Ihre Buchung bei der Deutschen Bahn.
Auftragsnummer 555666777888 wie folgt gebucht:
Leistungen
Sparpreis, 2. Klasse
Hinfahrt
von Lübeck Hbf, 20.12.2026 22:30 Uhr
nach Schwerin Hbf, 21.12.2026 00:05 Uhr
Rückfahrt
von Schwerin Hbf, 27.12.2026 16:10 Uhr
nach Lübeck Hbf, 27.12.2026 17:25 Uhr
Die Zahlung des Gesamtpreises dieser Reise in Höhe von 39,80 EUR wird
per PayPal durchgeführt.`;

/** DB "Online-Ticket" PDF text (2010–2019 layout), outward and return. */
export const DB_ONLINE_TICKET = `Online-Ticket
Bitte auf A4 ausdrucken
ICE Fahrkarte
Gültigkeit: 02.05.2016 - 06.05.2016
Flexpreis (Hin- und Rückfahrt)
Klasse: 2
Erw: 1
Hinfahrt: Osnabrück Hbf Magdeburg Hbf, mit ICE
Zahlungspositionen und Preis
Positionen Preis MwSt (D) 19%
ICE Fahrkarte 1 118,00€ 118,00€ 18,84€
Reservierungen 1 4,50€ 4,50€ 0,72€
Summe 122,50€ 122,50€ 19,56€
Die Buchung Ihres Online-Tickets erfolgte am 20.04.2016. DB Fernverkehr AG/DB Regio AG
Herr Max Mustermann
Auftragsnummer: Q7X2KT
Ihre Reiseverbindung und Reservierung Hinfahrt am 02.05.2016
Halt Datum Zeit Gleis Produkte Reservierung
Osnabrück Hbf 02.05. ab 07:12 3
Hannoversch Musterdorf 02.05. an 08:05 11
IC 2217 1 Sitzplatz, Wg. 7, Pl. 45, 1 Fenster, Großraum,
Nichtraucher
Hannoversch Musterdorf 02.05. ab 08:31 12
Magdeburg Hbf 02.05. an 09:59 4
RE 8,
RE 18
Ihre Reiseverbindung und Reservierung Rückfahrt am 06.05.2016
Halt Datum Zeit Gleis Produkte Reservierung
Magdeburg Hbf 06.05. ab 17:02 2
Osnabrück Hbf 06.05. an 19:40 1
ICE 1507
Wichtige Nutzungshinweise:
- Die Fahrkarte gilt nur zusammen mit einem Lichtbildausweis.`;

/** DB postal order (2010–2015): one line per direction, the whole journey. */
export const DB_POSTAL_ORDER = `Sehr geehrter Herr Mustermann,
vielen Dank für Ihre Fahrkartenbestellung. Wir bearbeiten Ihren Auftrag schnellstmöglich und stellen Ihnen die
Fahrkarte per Post zu.
Ihre Buchungsdaten:
Auftragsnummer: ZZ12AB
Reisedaten:
03.07.2015: Rostock Hbf 09:27 - Erfurt Hbf 14:05
05.07.2015: Erfurt Hbf 15:10 - Rostock Hbf 19:44
Fahrkarten:
Hin- und Rückfahrt, Normalpreis, 1 Reisender mit BahnCard 50 (1. Klasse), 2. Kl., Rostock/Erfurt
Preis: 150,00 EUR
Zusammenfassung Preise:
Fahrkarten: 150,00 EUR
Versandpauschale: 3,90 EUR
Gesamtpreis: 153,90 EUR
DB Vertrieb GmbH`;

/** DB "Verbindungsauskunft" (2008): one row per train, a walk in between. */
export const DB_CONNECTION_INFO = `DB Vertrieb GmbH
Auftragsbestätigung zum Auftrag 11223344 vom 12.02.2008.
Leistung 1
Reservierung, Klasse: 2, Anzahl Personen: 1
Gesamtpreis: 55,20 EUR
Verbindungsauskunft zur Leistung 1
Hinfahrt:
Kiel Hbf-Hamburg Hbf, 21.03.08, (RE 21013), Abfahrt Kiel Hbf: 23:10 Uhr, Gleis 4, Ankunft Hamburg Hbf: 00:25 Uhr, Gleis 7
Hamburg Hbf-Hamburg Hbf Gl.5-8, 22.03.08, (Fußweg)
Hamburg Hbf-Bremen Hbf, 22.03.08, (ICE 870), Abfahrt Hamburg Hbf Gl.5-8: 06:01 Uhr, Gleis 13, Ankunft Bremen Hbf: 06:59 Uhr, Gleis 9`;

/** A calendar file in the verified DB layout (no train number). */
export const DB_CALENDAR = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:http://www.bahn.de",
  "BEGIN:VEVENT",
  "UID:bahn20260314080500",
  "SUMMARY:Kiel Hbf -> Bremen Hbf",
  "DTSTART;TZID=Europe//Berlin:20260314T080500",
  "DTEND;TZID=Europe//Berlin:20260314T104300",
  "DESCRIPTION:Reise: Kiel Hbf nach Bremen Hbf\\nDatum: 14.03.2026\\n\\nab Kiel Hbf 08:05\\nan Br",
  " emen Hbf 10:43\\n\\nAlle Angaben ohne Gewähr.",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

/** HYPOTHESIS: a calendar file that names the train in its summary. Unverified. */
export const CALENDAR_WITH_TRAIN = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "SUMMARY:ICE 1507 Hamburg Hbf → Bremen Hbf",
  "DTSTART;TZID=Europe/Berlin:20260314T094600",
  "DTEND;TZID=Europe/Berlin:20260314T104300",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "SUMMARY:Bremen Hbf -> Kiel Hbf",
  "DTSTART:20260315T160000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

/** A DB delay alert: names an order and prints an ab/an table — not a booking. */
export const DB_DELAY_ALERT = `Verspaetungs-Alarm (Auftrag QQ11ZZ)
Sehr geehrter Herr Mustermann,
für Ihre gebuchte Verbindung haben sich Abweichungen ergeben.
Gebuchte Verbindung
Bahnhof/Haltestelle Datum Zeit
Kiel Hbf 04.11.2026 ab 12:55
Bremen Hbf 04.11.2026 an 15:38
Ermittelte Abweichung: Verspätung
Ihr Team von www.bahn.de`;

/** A DB loyalty newsletter: rail vocabulary, no booking. */
export const DB_NEWSLETTER = `Ihr aktueller Punktestand bei bahn.bonus
Sehr geehrter Herr Mustermann,
mit Ihrer BahnCard sammeln Sie bei jeder Fahrkarte Punkte.
Jetzt Prämien auswählen auf www.bahn.de/bahnbonus`;

/** A legless DB order mail: reference and total, the itinerary is in the attached PDF. */
export const DB_ORDER_WITHOUT_ITINERARY = `Buchungsbestätigung (Auftrag Q7X2KT)
Sehr geehrter Herr Mustermann,
vielen Dank für Ihren Fahrkartenkauf.
Ihre Buchungsdaten:
Auftragsnummer: Q7X2KT
Den Betrag in Höhe von 122,50 EUR buchen wir unter Ihrer Mandatsreferenz ab.
DB Vertrieb GmbH`;

/** A non-DB rail ticket no template knows — the LLM path. */
export const FOREIGN_TICKET_THIN = `Votre billet
Paris Gare de Lyon -> Lyon Part Dieu
Départ 12/04/2026 08:04, arrivée 10:00
Voiture 12, place 64`;

/** A flight confirmation and a hotel confirmation — detection negatives. */
export const FLIGHT_MAIL = `Lufthansa – Ihre Buchungsbestätigung
Buchungscode: X7K2QP
Flug LH 401 am 14. März 2026
Strecke: FRA – JFK
Frankfurt am Main, Terminal 1, Gate B24
Abflug 10:25 Uhr, Boarding ab 09:45 Uhr
Freigepäck: 1 Gepäckstück bis 23 kg
Rail&Fly: Ihre Fahrkarte zum Flug gilt in allen Zügen der Deutschen Bahn.`;

export const HOTEL_MAIL = `Booking.com – Ihre Buchung ist bestätigt
Hotel am Bahnhof, Musterstadt
Anreise: Freitag, 12. Juni 2026 ab 15:00 Uhr
Abreise: Montag, 15. Juni 2026 bis 11:00 Uhr
3 Nächte, 2 Gäste
Zimmerkategorie: Doppelzimmer
Anfahrt: 5 Minuten zu Fuß vom Hauptbahnhof, Gleis 1 Ausgang Nord.`;

export const CRUISE_MAIL = `AIDA Cruises – Ihre Reiseunterlagen
Kreuzfahrt "Ostsee"
Einschiffung: 07. Juni 2026, Hafen Kiel
Anreise mit der Bahn: Zug zum Schiff buchbar.
Kabine 8215, Deck 8 (Balkonkabine)
Seetag am 09. Juni`;

/**
 * Shaped like the Lufthansa mail of acceptance D1 ("Buchungsdetails | Abflug:
 * 06 Mai 2024 | MUC-FRA"), dropped into the rail dialog. Synthetic: no name,
 * reference or number from the real document.
 */
export const FLIGHT_MAIL_MUC_FRA = `Buchungsdetails | Abflug: 06 Mai 2024 | MUC-FRA

Ihre Buchungsdetails
Buchungscode: ZZ9K4Q
Hinflug: Montag, 06. Mai 2024
MUC - FRA
Abflug 07:00 München, Terminal 2
Ankunft 08:05 Frankfurt
LH 2001, Economy
Rückflug: Dienstag, 07. Mai 2024
FRA - MUC
Abflug 19:00 Frankfurt
Ankunft 20:00 München
LH 2008, Economy
Freigepäck: 1 x 23 kg
Online Check-in ab 23 Stunden vor Abflug`;
