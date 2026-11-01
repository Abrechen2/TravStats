# TravStats · Einstellungen neu — Konzept (Runde 2, 01.11.2026)

Gehört zu `Einstellungen Entwurf.dc.html` (Canvas: **R** Änderungen, **G** Gliederung, **B** Bausteine, Bildschirme **1a–8b**) und dem klickbaren Prototyp `Einstellungen.dc.html`. Gliederung, Texte, Dialoge und Zuordnung kommen aus `settings-data.json`; die Tabellen unten sind daraus erzeugt. Runde 1 liegt unverändert in `Runde 1/`.

Markierungen: **[Annahme]** = weiterhin nicht belegt. **[belegt R…]** = durch `Antworten-Rueckfragen.md` bestätigt. **[widerlegt R…]** = korrigiert.

## Was sich gegenüber Runde 1 geändert hat

**Entscheidungen des Owners**
- Wohnort und Heimatort sind dasselbe: ein Wohnort mit Zeiträumen; ein Umzug beginnt einen neuen Zeitraum. Hilfetext entsprechend.
- „Routen auf der Karte“ (Kreuzfahrten) und „Sitzplatz-Statistik“ (Flüge) gestrichen; beide leben im Kontext (Kartenpanel, Statistik-Blöcke).
- Konto löschen fertig gezeichnet: Gefahr-Aktion, Tippwort LÖSCHEN, Zustand „Löschung läuft bis {Datum}“, „Löschung abbrechen“ (Bildschirme 8a, 8b, Baustein B17).
- Adressen englisch, heutige Seitennamen bleiben; neue Seiten heißen `domains`, `sharing`, `notifications`, `server`, `users`, `backups`, `maintenance`, `masterdata`, `about`. Abschnitt 6 neu.
- Hell/Dunkel, `timezoneFollowsDevice`, `units.currency`, `boardingPassParserStrategy`, Log-Dateigröße/-anzahl: nicht angeboten. Rollen ändern: nicht gezeichnet.
- Speichern: Die Auswahl bleibt stehen (Auftrag). Das ändert das heutige Verhalten (R1); der Bau zieht nach.

**Aus den Antworten auf die Rückfragen**
- **R7:** Die Dienste-Seite ist neu aufgebaut: **31 Karten, eine je Katalog-Eintrag**, in den sieben Katalog-Gruppen. Jede Karte hat nur die Fähigkeiten aus der Katalog-Tabelle (Admin-Schalter, Konto-Schalter, Tester, Kontingent/Budget, immer an). Gestrichen gegenüber Runde 1: „Für mich nutzen“ und „Testen“ bei Bahn-Fahrplänen, „Testen“ bei eigenem Routing und offenen Daten; Nutzungsstatistik ist jetzt eine eigene Karte (vorher Server-Seite).
- **R8:** Dawarich als Quelle, Aufenthaltssuche, Verlauf kopieren und Ländertage brauchen die **eigene** Verbindung. Die Abhängigkeit sagt: „Braucht deine eigene Dawarich-Verbindung. Die des Servers reicht dafür nicht.“ Die Server-Verbindung erklärt, dass sie nur für Tracks von Touren und Kreuzfahrten dient.
- **R19:** Öffentliche Adresse ist Pflicht und warnt, solange sie fehlt (Baustein B15). Hilfetext „wird aus der Anfrage erkannt“ gestrichen. LAN-Adresse sagt „Nur für den Rücksprung von Strava“.
- **R3:** Die Experten-Zeile in Daten › Sicherung war „Letzte Instanz-Sicherung“. Sie ist jetzt eine Standard-Statuszeile für alle (Bau-Hinweis: heute lädt nur ein Admin die Daten, alle anderen sehen „keine Sicherung“).
- **R21:** Der Ersetzen-Dialog nennt die betroffenen Blätter und sagt „Sicherung des ganzen Servers“.
- **R22:** Demo-Sperren folgen dem Server: gesperrt sind Profil, Zuhause, Anmeldung, Telefone, API-Schlüssel, Erinnerungen, Standortquelle, Dienste, Live-Updates, Anreicherung, Teilen mit Konten, Vergleich, Excel-Import, eigene WebDAV-Kopie, Konto löschen. Sprache & Einheiten sind frei (Frage 28).
- **R14:** Erinnerungen › Wohin hat die Zeile „Mitteilungen an die App“ mit Abhängigkeit zum Push-Schalter des Servers.
- **R2:** Touren hängen am Reiseart-Schalter `roadtrip` (Beta `roadtrips`); die Zeile „Touren — Wandern, Rad, Roadtrip“ ist dieser Schalter.

**Aus der Zweitprüfung**
1. Zugangsdaten vollständig: OpenSky Client-ID, Client-Secret (+ Benutzer/Passwort Experte) je Konto **und** je Server; Immich- und Dawarich-Server-Verbindung mit Adresse **und** Schlüssel; WebDAV Server mit Adresse, Benutzer, Passwort.
2. Schlüssel und Verbindungen sind Standard, auch auf Server-Ebene; „Echte Flugwege nach der Landung“ ist Standard. Experte bleiben nur Adressen, Modelle, Ports, Ordner, Grenzen der Feinarbeit.
3. Gesperrt heißt gesperrt: Bedienelemente sind `disabled` + `aria-disabled`, nicht fokussierbar; der Grund steht als Zeile darunter.
4. Dialoge halten den Fokus (Tab läuft im Kreis), Start auf „Abbrechen“, Escape schließt, das Tippwort wird geprüft.
5. Suche sagt „8 von 23 Treffern · weiter tippen“.
6. Alle Dialoge (29), Aktionsergebnisse, Status und Formmeldungen stehen vollständig auf Deutsch und Englisch; Formmeldungen in der Ich-Form; kein „—“ mehr.
7. Abstände, Radien und Schriftgrößen im Entwurf nur noch aus `tokens.json` (4 · 8 · 10 · 14 · 20 · 24 · 28; Radien 12 · 14 · 16 · 18 · 26 · 999; Schrift 10 · 11 · 12 · 14 · 16 · 26 · 42). Formfehler `bad`, gescheitertes Speichern `warn`.
8. Eine Gruppe mit ungespeicherten Änderungen fragt vor dem Verlassen (Bildschirm 5c).

## 0. Grundsätze

1. **Ein Menü** mit zwei Gruppen: *Dein Konto* (alle) und *Server · nur Admin*. Server-Zeilen zu einem Konto-Thema stehen an derselben Stelle mit „Alle Konten“; Admins sehen den Regler, alle anderen eine Statuszeile.
2. **Stufe in der Seitenleiste:** *Standard | Experte* unter der Suche, darunter „Experte zeigt N weitere Einstellungen“. Pro Konto gespeichert; neue Konten Standard, bestehende Experte.
3. **Name statt Absatz:** Name · höchstens eine Kurzzeile · der Rest hinter „?“.
4. **Nichts verschwindet still:** Wirkt eine Einstellung nicht, bleibt sie sichtbar (50 %, nicht bedienbar) und sagt, was fehlt.
5. **Speichern:** Einzelwerte sofort, drei Zustände, die Auswahl bleibt bei einem Fehler stehen. Gruppen mit Knopf und „Nicht gespeichert“-Warnung.

## 1. Gliederung

Menü:
- **Dein Konto:** Profil & Anmeldung · Sprache & Einheiten · Reisearten (eingerückt *Flüge*, *Kreuzfahrten*, solange an) · Reisen & Eingang · Teilen · Erinnerungen · Standort · Treueprogramme · Daten · Dienste
- **Server · nur Admin:** Server · Nutzer · Sicherungen · Wartung (Experte) · Stammdaten (Experte)
- **Fuß:** Über TravStats (Version; Build in Experte; Baustein „Ein Projekt von <abrechen2 />“)

Erster Besuch eines neuen Kontos: `/settings/domains` mit Karte „Zuerst“ (Sprache & Einheiten · Wohnort · Standortquelle), ausblendbar. Danach die zuletzt besuchte Seite. **[Annahme]**

### Profil & Anmeldung / Profile & sign-in — `/settings/account` — alle · Demo gesperrt
- **Profil** `#profile` · Gruppe „Profil speichern“ — A1
- **Zuhause** `#home` — A10
- **Anmeldung** `#security` — A1
- **Companion-App** `#devices` — A1
- **API-Schlüssel** `#apitokens` (Experte) — A1
- **Konto löschen** `#deletion` — E

### Sprache & Einheiten / Language & units — `/settings/display` — alle
- **Sprache & Zeit** `#language` — A3
- **Einheiten** `#units` — A3
- **Karte, Start & Listen** `#views` — A9

### Reisearten / Travel types — `/settings/domains` — alle
- **Was du festhältst** `#domains` — A4
- **Planen** `#planning` — A4
- **Länder** `#countryCounting` — A4

### Flüge / Flights — `/settings/flight` — alle · solange die Reiseart an ist
- **Heimatflughäfen** `#homeAirport` — A10
- **Neue Flüge starten mit** `#defaults` — A10
- **Was festgehalten wird** `#features` — A10
- **Live-Updates** `#autoupdate` · Demo gesperrt — A10
- **Ältere Flüge ergänzen** `#enrichment` (Experte) · Demo gesperrt — A10

### Kreuzfahrten / Cruises — `/settings/cruise` — alle · solange die Reiseart an ist
- **Neue Kreuzfahrten starten mit** `#cruisePreferences` — A10
- **Zählen** `#counting` — A10

### Reisen & Eingang / Trips & inbox — `/settings/trips` — alle
- **Reisen** `#trips` — A5
- **Vorschläge im Eingang** `#suggestions` — A5
- **Kalender** `#calendarFeed` — A5

### Teilen / Sharing — `/settings/sharing` — alle
- **Mitreisende** `#companions` — A6
- **Mit Konten auf diesem Server** `#accounts` · Demo gesperrt — A5
- **Mit anderen Servern** `#servers` — A5
- **Öffentliche Links** `#shareLinks` — C1, A12
- **Vergleichen & übergeben** `#compare` · Demo gesperrt — A12

### Erinnerungen / Reminders — `/settings/notifications` — alle · Demo gesperrt
- **Wohin** `#channel` — A2
- **Vor der Abreise** `#domains` — A2

### Standort / Location — `/settings/location` — alle
- **Quelle** `#locationProvider` · Demo gesperrt — A8
- **Aufenthalte finden** `#stayScan` — A8
- **TravTrack** `#travTrack` — A8
- **Verlauf** `#history` — A8

### Treueprogramme / Loyalty — `/settings/loyalty` — alle
- **Karten** `#loyalty` — A7

### Daten / Data — `/settings/data` — alle
- **Sicherung** `#backup` — A11
- **Mitnehmen** `#export` — A11
- **Einlesen** `#import` — A11
- **Beim Import von bahn.de** `#railImport` (Experte) — A11

### Dienste / Services — `/settings/services` — alle · Demo gesperrt
- **Flugdaten** (7): AirLabs `airlabs`, Aviationstack `aviationstack`, AeroDataBox `aerodatabox`, FlightAware AeroAPI `aeroapi`, OpenSky `opensky`, ADS-B Lol `adsblol`, ADS-B Exchange `adsbx`
- **Karten & Routen** (7): AISStream `aisstream`, OpenRouteService `openrouteservice`, GraphHopper `graphhopper`, Transitous & db-rest `railTimetables`, Google Places `googlePlaces`, Photon & Nominatim `geocoder`, OSRM & OpenRailRouting `selfHostedRouting` (nur Admin)
- **Fotos & Standort** (3): Immich `immich`, Dawarich `dawarich`, Strava `strava`
- **KI** (5): Ollama `ollama`, OpenAI `openai`, Anthropic `anthropic`, Google Gemini `gemini`, OpenAI-kompatibel `customLlm`
- **Offene Daten** (3): OpenStreetMap · Overpass `openData`, Logostream `logos`, EZB-Kurse `fx`
- **Sync & Mail** (3): WebDAV `webdav`, Mail (SMTP) `smtp` (nur Admin), Push `push` (nur Admin)
- **Instanz** (3): Andere Server `federation` (nur Admin), Nutzungsstatistik `usageStats` (nur Admin), GitHub `updatesTemplates` (nur Admin)
- 31 Karten, eine je Katalog-Eintrag (R7). Zusammengelegt wird nichts, was der Katalog trennt; „Transitous & db-rest“ und „Photon & Nominatim“ sind im Katalog selbst je **ein** Eintrag.

### Server / Server — `/settings/server` — nur Admin
- **Allgemein** `#general` · Gruppe „Speichern“ — C1
- **Adressen** `#addresses` · Gruppe „Speichern“ — C1
- **Passkeys** `#passkeys` (Experte) · Gruppe „Speichern“ — C1
- **Was der Server anbietet** `#features` — C1
- **Buchungen lesen** `#parsers` · Gruppe „Speichern“ — C4

### Nutzer / Users — `/settings/users` — nur Admin
- **Zugang** `#access` · Gruppe „Speichern“ — C1
- **Konten** `#accounts` — C2
- **Einladungen** `#invitations` — C2

### Sicherungen / Backups — `/settings/backups` — nur Admin
- **Automatisch** `#automatic` · Gruppe „Speichern“ — C6
- **Vorhandene Sicherungen** `#backups` — C6

### Wartung / Maintenance — `/settings/maintenance` — nur Admin · Experte
- **Protokoll** `#logging` (Experte) — C7
- **System** `#system` (Experte) — C7, C7/C3
- **Zeitzonen** `#timeModel` (Experte) — C7

### Stammdaten / Reference data — `/settings/masterdata` — nur Admin · Experte
- **Kataloge** `#catalogues` (Experte) — C7

### Über TravStats / About TravStats — `/settings/about` — alle
- **Version** `#about` — C1


### 1.1 Zusammengelegt

| Was | Woraus | Begründung |
|---|---|---|
| **Wohnort** mit Zeiträumen | A10 Home residence + A10 Home place | Owner: dasselbe. Der Heimatort ist der Wohnort des laufenden Zeitraums. **[belegt Owner]** — Server und App werden umgestellt (R4 beschreibt den heutigen getrennten Stand). |
| **Öffentliche Links erlauben** | C1 + gespiegelter Schalter A12 | Owner angenommen. Ein Regler in Teilen › Öffentliche Links. |
| **Reisen mit anderen Servern teilen** | C1 Trip sharing across servers + C8 | dieselbe Funktion; Dienste › Andere Server. |
| **Standort kommt von** | A8 Location source + „Use Dawarich?“-Hinweis | Der Hinweis wiederholt die Auswahl. |
| **Kartendarstellung** (Sprung) | A9 Map appearance + A3 Map theme | beides im Kartenpanel. |
| **Dienst-Karte** je Katalog-Eintrag | Konto-Seite (A13/A11) + Instanz-Seite (C3/C5/C6/C8) | Konto-Zeilen oben, Server-Zeilen „Alle Konten“ darunter. Nur Zusammenlegung von Konto- und Server-Sicht **desselben** Katalog-Eintrags; keine zwei Katalog-Einträge auf einer Karte. |
| **Ollama** | Adresse/Zustimmung (C3) + Modelle/Laden (C4) | Owner angenommen. „KI verwenden“, Reihenfolge und „Ollama prüfen“ bleiben in Server › Buchungen lesen. |
| **Erinnerungen pro Reiseart** | A2 an/aus + Vorlauf + Kanal | eine Zeile je Reiseart. |
| **Reiseart an/aus + Farbe** | A4 | eine Zeile je Reiseart. |

### 1.2 Verlegt

| Was | Von → nach | Begründung |
|---|---|---|
| Heimatland, Reisepass, Wohnort | `account#profile` (Karten HomeCountry, PersonalFacts, R9) und `flight#homeAirport` → `/settings/account#home` | Owner angenommen; gilt für jede Reiseart. |
| Heimatflughäfen | bleiben `/settings/flight#homeAirport` | nur Flug. |
| Mail (SMTP), WebDAV-Zugang, Push, Föderation, Nutzungsstatistik, Updates & Vorlagen | Admin-Seiten → `/settings/services` | Owner angenommen; alle sind Katalog-Einträge (R7). |
| WebDAV aufgeteilt | Zugang → Dienste › WebDAV; Takt/Versionen der eigenen Kopie → `data#backup`; Aufbewahrung/Uhrzeit der Server-Sicherung → `backups#automatic` | Owner angenommen. |
| Wer zuerst liest, KI verwenden, Cloud-Reihenfolge | `/admin/parsers` → `/settings/server#parsers` | Owner angenommen. Die eigene Route `/parser` (Parser-Werkzeug) bleibt. |
| Höchstens Konten, Anmelden ohne Einladung | `/admin/instance` → `/settings/users#access` | „wer kommt herein“. |
| Protokoll, System, Zeitzonen | drei Admin-Seiten → `/settings/maintenance` | Owner angenommen. |
| Mitreisende, Teilen, Öffentliche Links, Rangliste, Verschlüsselt | `companions`, `trips#sharing`, `privacy` → `/settings/sharing` | alles, was andere Menschen betrifft. |
| Logos neu laden | `/admin/system` → Dienste › Logostream | Aktion gehört zum Dienst. |
| Über TravStats | `/admin/instance#about` → `/settings/about`, für alle | Version ist keine Admin-Sache. |

### 1.3 Weggelassen (Owner hat angenommen)

Seite „Ansichten“ (drei Sprünge → `display#views`) · Seite „Privatsphäre“ (→ `sharing`) · Admin-Seiten Import & Parser, E-Mail, Zeitmodell, Logging, System · gespiegelter Link-Schalter in A12 · eigene Liste „Provided by the instance“ (→ Pille je Dienst-Karte) · „Routen auf der Karte“ (A10) · „Sitzplatz-Statistik“ (A10).

### 1.4 Bleibt im Kontext, im Bereich als Sprung oder Suchtreffer

Kartenpanel (B1), Startseite (B2), Listen (B3; Seitengröße ist Gerät **[belegt R11]**) → Sprünge in `display#views`. Öffentliche Links anlegen (B4) → an Flug/Reise/Jahr. Immich-Album pro Reise, Import-Assistent, Offene Updates, Eingang, Planen, Tour-Routing (B5). GPX-Importe → Track-Seite. Companion-App-Einstellungen (B6). Neu aus den Antworten: Passwort-Zurücksetzen-Anfragen bleiben im Admin-Eingang; Geräte-Merker (Galerie, Heatmap, Formular-Abschnitte, Einmal-Hinweise) sind keine Einstellungen.

## 2. Bausteine (Canvas B)

| Baustein | Zustände |
|---|---|
| B1 Einstellungszeile | Name · Geltung · EXPERTE · Speicherzustand · Kurzzeile · „?“ · Bedienung; darunter Fehlerzeile, Pflicht-Warnung, Abhängigkeit, Aufgabe, Hilfe, Einmal-gezeigt; hervorgehoben (proBg) |
| B2 Schalter | aus · an · Hover · Fokus · wirkt nicht · gesperrt — die letzten beiden `disabled` + `aria-disabled`, nicht fokussierbar, Grund als Zeile |
| B3 Auswahl | Segment (≤ 3) · Liste (≥ 4, Tippsuche) · gewählt · Fokus · gesperrt |
| B4 Eingabe | leer · Wert · geändert in Gruppe (accent 45 %) · Formfehler (`bad`-Rand + Ich-Zeile) · Geheimnis (nie wieder angezeigt, leer = behalten) · gesperrt |
| B5 Aktion / Status / Sprung | Aktion · Gefahr · Gruppe speichern · Status (Mono) · Sprung (Chevron) · Liste mit ⋯ · Ergebnis („Erledigt“-Zeile mit konkretem Text) |
| B6 Speicherzustand | einzeln: ruhend · Gleich gespeichert · Gespeichert · gescheitert (`warn`, Auswahl bleibt) + Erneut versuchen / Verwerfen. Gruppe: unverändert · Nicht gespeichert · Gleich gespeichert · Ergebnis kommt gleich · Verbunden · abgelehnt; Verlassen fragt |
| B7 Stufen-Umschaltung | Standard · Experte · Fokus · „Experte zeigt N weitere“ · Einmal-gezeigt mit „Immer zeigen“ |
| B8 Geltungsbereich | Konto (Seitenkopf) · Alle Konten (Zeile) · Nur dieses Gerät (Zeile) · Instanz-Seite (Seitenkopf) |
| B9 Bestätigung | Betrifft · Wie viel · Danach · Knopf nennt die Menge · Tippwort · Fokusfalle · Escape · Verlassen-Variante (Bleiben / Verwerfen) |
| B10 Abhängigkeit | Reiseart aus · Dienst fehlt · eigene Verbindung fehlt · Admin hat nicht erlaubt · Statuszeile statt Regler |
| B11 Hintergrundaufgabe | wartet · läuft % · fertig · angehalten · gescheitert · Ausgang unbekannt |
| B12 Dienst-Karte | zu · offen · nur Status (ohne Chevron, wenn ein Konto nichts einstellen kann) · Pillen |
| B13 Menüeintrag | ruhend · aktiv · Unterseite · warn-Punkt · Experte |
| B14 Reiseart-Farben | `domainColor` |
| B15 Pflichtangabe fehlt | `warn`-Rand + Zeile, warn-Punkt am Menüeintrag |
| B16 Suche | Treffer · Experten-Treffer · gekappt („8 von N · weiter tippen“) · nichts gefunden |
| B17 Konto löschen | bereit · Dialog mit Tippwort · Löschung läuft bis {Datum} + Abbrechen · Demo gesperrt |

## 3. Bildschirme

1a/1b erster Besuch · 2a/2b Speichern scheitert, 2c iPad hoch · 3a/3b Standort und Aufenthalte · 4a–4c Immich verbinden und testen · 5a/5b Admin ändert die Adresse für Telefone, 5c Verlassen mit ungespeicherter Gruppe · 6a–6c Suche „Update“ findet die Experten-Zeile bei Stufe Standard · 7a–7c Excel-Import ersetzen, dann Hintergrundaufgabe · 8a/8b Konto löschen.

## 4. Zuordnung jedes Inventar-Eintrags

337 Zeilen aus `settings-data.json`; Dienst-Fähigkeiten je Dienst einzeln.

| Inventar | Neue Seite | Abschnitt / Dienst | Baustein | Stufe | Wer sieht ihn |
|---|---|---|---|---|---|
| A1 Profile picture | Profil & Anmeldung `account` | Profil | Aktion (Datei) | Standard | alle |
| A1 First name | Profil & Anmeldung `account` | Profil | Eingabe · Gruppe | Standard | alle |
| A1 Last name | Profil & Anmeldung `account` | Profil | Eingabe · Gruppe | Standard | alle |
| A1 Username | Profil & Anmeldung `account` | Profil | Status | Standard | alle |
| A1 E-mail address (profile) | Profil & Anmeldung `account` | Profil | Eingabe · Gruppe | Standard | alle |
| A1 Birthday | Profil & Anmeldung `account` | Profil | Eingabe · Gruppe | Standard | alle |
| A10 Home (residence, periods) + A10 Home place | Profil & Anmeldung `account` | Zuhause | Liste + Aktion | Standard | alle |
| A10 Home country | Profil & Anmeldung `account` | Zuhause | Auswahl (Liste) | Standard | alle |
| A10 Passport valid until | Profil & Anmeldung `account` | Zuhause | Eingabe | Standard | alle |
| A1 Password | Profil & Anmeldung `account` | Anmeldung | Aktion | Standard | alle |
| A1 Two-factor authentication (TOTP) | Profil & Anmeldung `account` | Anmeldung | Schalter | Standard | alle |
| A1 Recovery codes | Profil & Anmeldung `account` | Anmeldung | Aktion + Bestätigung + Abhängigkeit | Standard | alle |
| A1 Passkeys | Profil & Anmeldung `account` | Anmeldung | Liste + Aktion | Standard | alle |
| A1 Paired devices (Companion app) | Profil & Anmeldung `account` | Companion-App | Liste + Aktion | Standard | alle |
| A1 API tokens | Profil & Anmeldung `account` | API-Schlüssel | Liste + Aktion | Experte | alle |
| E Account deletion (Owner: wird gebaut) | Profil & Anmeldung `account` | Konto löschen | Aktion (Gefahr) + Bestätigung | Standard | alle |
| A3 Language | Sprache & Einheiten `display` | Sprache & Zeit | Auswahl (Segment) | Standard | alle |
| A3 Time zone | Sprache & Einheiten `display` | Sprache & Zeit | Auswahl (Liste) | Standard | alle |
| A3 Date format | Sprache & Einheiten `display` | Sprache & Zeit | Auswahl (Segment) | Standard | alle |
| A3 Time format | Sprache & Einheiten `display` | Sprache & Zeit | Auswahl (Segment) | Standard | alle |
| A3 Distance unit | Sprache & Einheiten `display` | Einheiten | Auswahl (Segment) | Standard | alle |
| A3 Weight unit | Sprache & Einheiten `display` | Einheiten | Auswahl (Segment) | Standard | alle |
| A3 Base currency | Sprache & Einheiten `display` | Einheiten | Auswahl (Liste) | Standard | alle |
| A9 Map appearance link + A3 Map theme | Sprache & Einheiten `display` | Karte, Start & Listen | Sprung | Standard | alle |
| A9 Dashboard link | Sprache & Einheiten `display` | Karte, Start & Listen | Sprung | Standard | alle |
| A9 Lists link | Sprache & Einheiten `display` | Karte, Start & Listen | Sprung | Standard | alle |
| A4 Domain on/off + Domain colour (flight) | Reisearten `domains` | Was du festhältst | Schalter + Farbe | Standard | alle |
| A4 Domain on/off + Domain colour (cruise) | Reisearten `domains` | Was du festhältst | Schalter + Farbe | Standard | alle |
| A4 Domain on/off + Domain colour (lodging) | Reisearten `domains` | Was du festhältst | Schalter + Farbe | Standard | alle |
| A4 Domain on/off + Domain colour (poi) | Reisearten `domains` | Was du festhältst | Schalter + Farbe | Standard | alle |
| A4 Domain on/off + Domain colour (rail) | Reisearten `domains` | Was du festhältst | Schalter + Farbe | Standard | alle |
| A4 Domain on/off + Domain colour (bus) | Reisearten `domains` | Was du festhältst | Schalter + Farbe | Standard | alle |
| A4 Domain on/off + Domain colour (ferry) | Reisearten `domains` | Was du festhältst | Schalter + Farbe | Standard | alle |
| A4 Domain on/off + Domain colour (rental) | Reisearten `domains` | Was du festhältst | Schalter + Farbe | Standard | alle |
| A4 Domain on/off + Domain colour (roadtrip/tour) | Reisearten `domains` | Was du festhältst | Schalter + Farbe | Standard | alle |
| A4 Action: reset colours | Reisearten `domains` | Was du festhältst | Aktion | Standard | alle |
| A4 TravPlan on/off | Reisearten `domains` | Planen | Schalter | Standard | alle |
| A4 Country counting threshold | Reisearten `domains` | Länder | Auswahl (Liste) | Standard | alle |
| A10 Home (home airports) | Flüge `flight` | Heimatflughäfen | Liste + Aktion | Standard | alle, solange Reiseart an |
| A10 Flight defaults — status | Flüge `flight` | Neue Flüge starten mit | Auswahl (Segment) | Standard | alle, solange Reiseart an |
| A10 Flight defaults — seat class | Flüge `flight` | Neue Flüge starten mit | Auswahl (Liste) | Standard | alle, solange Reiseart an |
| A10 Flight defaults — favourite airline | Flüge `flight` | Neue Flüge starten mit | Eingabe | Standard | alle, solange Reiseart an |
| A10 Flight defaults — category | Flüge `flight` | Neue Flüge starten mit | Auswahl (Liste) | Standard | alle, solange Reiseart an |
| A10 Cost tracking | Flüge `flight` | Was festgehalten wird | Schalter | Standard | alle, solange Reiseart an |
| A10 Track tail numbers | Flüge `flight` | Was festgehalten wird | Schalter | Standard | alle, solange Reiseart an |
| A10 Live tracking | Flüge `flight` | Was festgehalten wird | Schalter | Standard | alle, solange Reiseart an |
| A10 Automatic updates | Flüge `flight` | Live-Updates | Schalter + Abhängigkeit | Standard | alle, solange Reiseart an |
| A10 Require approval for updates | Flüge `flight` | Live-Updates | Schalter | Standard | alle, solange Reiseart an |
| A10 Update expiry | Flüge `flight` | Live-Updates | Eingabe | Experte | alle, solange Reiseart an |
| A10 Action: View pending updates | Flüge `flight` | Live-Updates | Sprung | Standard | alle, solange Reiseart an |
| A10 Historical enrichment | Flüge `flight` | Ältere Flüge ergänzen | Schalter | Experte | alle, solange Reiseart an |
| A10 Enrichment min. confidence | Flüge `flight` | Ältere Flüge ergänzen | Eingabe | Experte | alle, solange Reiseart an |
| A10 Enrichment max per day | Flüge `flight` | Ältere Flüge ergänzen | Eingabe | Experte | alle, solange Reiseart an |
| A10 Action: Enrich | Flüge `flight` | Ältere Flüge ergänzen | Aktion | Experte | alle, solange Reiseart an |
| A10 Cruise — default line | Kreuzfahrten `cruise` | Neue Kreuzfahrten starten mit | Eingabe | Standard | alle, solange Reiseart an |
| A10 Cruise — default cabin category | Kreuzfahrten `cruise` | Neue Kreuzfahrten starten mit | Auswahl (Liste) | Standard | alle, solange Reiseart an |
| A10 Count sea days | Kreuzfahrten `cruise` | Zählen | Schalter | Standard | alle, solange Reiseart an |
| A5 Create trips automatically on import | Reisen & Eingang `trips` | Reisen | Schalter | Standard | alle |
| A5 Default colour for new trips | Reisen & Eingang `trips` | Reisen | Auswahl (Liste) | Standard | alle |
| A5 Trip suggestions | Reisen & Eingang `trips` | Vorschläge im Eingang | Schalter | Standard | alle |
| A5 Stay suggestions | Reisen & Eingang `trips` | Vorschläge im Eingang | Schalter + Abhängigkeit | Standard | alle |
| A5 Immich photos as place evidence | Reisen & Eingang `trips` | Vorschläge im Eingang | Schalter + Abhängigkeit | Standard | alle |
| A5 AI place-type classification | Reisen & Eingang `trips` | Vorschläge im Eingang | Schalter + Abhängigkeit | Standard | alle |
| A5 Calendar subscription link | Reisen & Eingang `trips` | Kalender | Aktion | Standard | alle |
| A6 Companion list | Teilen `sharing` | Mitreisende | Liste + Aktion + Bestätigung | Standard | alle |
| A5 Trip sharing — requests | Teilen `sharing` | Mit Konten auf diesem Server | Liste + Aktion | Standard | alle |
| A5 Link companion to account | Teilen `sharing` | Mit Konten auf diesem Server | Auswahl (Liste) | Standard | alle |
| A5 Cross-server sharing — invitation codes | Teilen `sharing` | Mit anderen Servern | Aktion + Abhängigkeit | Standard | alle |
| C1 Public links permission + A12 Allow public links | Teilen `sharing` | Öffentliche Links | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| A12 Public links list | Teilen `sharing` | Öffentliche Links | Liste + Aktion | Standard | alle |
| A12 Comparison consent | Teilen `sharing` | Vergleichen & übergeben | Sprung | Standard | alle |
| A12 Encrypted sharing grants | Teilen `sharing` | Vergleichen & übergeben | Sprung | Standard | alle |
| A2 Reminder e-mail address | Erinnerungen `notifications` | Wohin | Eingabe | Standard | alle |
| A2 Channel per area (App-Verfügbarkeit, R14) | Erinnerungen `notifications` | Wohin | Status + Abhängigkeit | Standard | alle |
| A2 Reminders on/off + Lead times + Channel (flight) | Erinnerungen `notifications` | Vor der Abreise | Schalter + Vorlauf-Chips + Kanal | Standard | alle |
| A2 Reminders (cruise) | Erinnerungen `notifications` | Vor der Abreise | Schalter + Vorlauf-Chips + Kanal + Abhängigkeit | Standard | alle |
| A2 Reminders (rail) | Erinnerungen `notifications` | Vor der Abreise | Schalter + Vorlauf-Chips + Kanal | Standard | alle |
| A2 Reminders (bus) | Erinnerungen `notifications` | Vor der Abreise | Schalter + Vorlauf-Chips + Kanal | Standard | alle |
| A2 Reminders (ferry) | Erinnerungen `notifications` | Vor der Abreise | Schalter + Vorlauf-Chips + Kanal | Standard | alle |
| A2 Reminders (lodging) | Erinnerungen `notifications` | Vor der Abreise | Schalter + Vorlauf-Chips + Kanal | Standard | alle |
| A8 Location source + A8 Use Dawarich hint | Standort `location` | Quelle | Auswahl (Segment) | Standard | alle |
| A8 Dawarich connection (pointer) | Standort `location` | Quelle | Sprung | Standard | alle |
| A8 Trip recording | Standort `location` | Quelle | Schalter | Standard | alle |
| A8 Stay scan — detect stays automatically | Standort `location` | Aufenthalte finden | Schalter + Abhängigkeit | Standard | alle |
| A8 Scan period | Standort `location` | Aufenthalte finden | Auswahl (Liste) | Experte | alle |
| A8 Action: Scan now | Standort `location` | Aufenthalte finden | Aktion + Hintergrundaufgabe + Abhängigkeit | Standard | alle |
| A8 TravTrack summary | Standort `location` | TravTrack | Status | Standard | alle |
| A8 Privacy zones | Standort `location` | TravTrack | Liste + Aktion + Bestätigung | Standard | alle |
| A8 City lookup in monthly values | Standort `location` | TravTrack | Schalter | Standard | alle |
| A8 Further sources (OwnTracks / Overland keys) | Standort `location` | TravTrack | Liste + Aktion | Experte | alle |
| A8 Copy Dawarich history | Standort `location` | Verlauf | Aktion + Hintergrundaufgabe + Abhängigkeit | Standard | alle |
| A8 GPX imports (history) | Standort `location` | Verlauf | Sprung | Standard | alle |
| A8 Export history | Standort `location` | Verlauf | Aktion + Hintergrundaufgabe | Standard | alle |
| A8 Delete a span | Standort `location` | Verlauf | Aktion (Gefahr) + Bestätigung | Standard | alle |
| A8 Diagnostics | Standort `location` | Verlauf | Aktion | Experte | alle |
| A7 Programme cards (airline) | Treueprogramme `loyalty` | Karten | Liste + Aktion | Standard | alle |
| A7 Programme cards (lodging) | Treueprogramme `loyalty` | Karten | Liste + Aktion | Standard | alle |
| A7 Programme cards (rail) | Treueprogramme `loyalty` | Karten | Liste + Aktion | Standard | alle |
| A7 Programme cards (cruise) | Treueprogramme `loyalty` | Karten | Liste + Aktion + Abhängigkeit | Standard | alle |
| A11 Instance backup status + A11 Backup extra row (R3: „Letzte Instanz-Sicherung“) | Daten `data` | Sicherung | Status | Standard | alle |
| A11 WebDAV sync (own storage) | Daten `data` | Sicherung | Schalter + Abhängigkeit | Standard | alle |
| A11 WebDAV sync — schedule | Daten `data` | Sicherung | Auswahl (Segment) + Abhängigkeit | Standard | alle |
| A11 WebDAV sync — versions to keep | Daten `data` | Sicherung | Eingabe + Abhängigkeit | Experte | alle |
| A11 Action: WebDAV Sync now | Daten `data` | Sicherung | Aktion + Hintergrundaufgabe + Abhängigkeit | Standard | alle |
| A11 Download my data | Daten `data` | Mitnehmen | Aktion + Hintergrundaufgabe | Standard | alle |
| A11 Excel export | Daten `data` | Mitnehmen | Aktion + Hintergrundaufgabe | Standard | alle |
| A11 Recordings as GPX | Daten `data` | Mitnehmen | Aktion + Hintergrundaufgabe + Abhängigkeit | Standard | alle |
| A11 Import lists hub | Daten `data` | Einlesen | Sprung | Standard | alle |
| A11 Excel import | Daten `data` | Einlesen | Aktion + Hintergrundaufgabe + Bestätigung | Standard | alle |
| A11 Read GPX / TCX / FIT / ZIP | Daten `data` | Einlesen | Aktion + Hintergrundaufgabe + Abhängigkeit | Standard | alle |
| A11 Import log | Daten `data` | Einlesen | Liste + Aktion | Standard | alle |
| A11 Rail import: U-Bahn/tram legs | Daten `data` | Beim Import von bahn.de | Auswahl (Segment) | Experte | alle |
| A11 Rail import: bus legs | Daten `data` | Beim Import von bahn.de | Auswahl (Segment) | Experte | alle |
| A13 Own API key per provider — AirLabs | Dienste `services` | AirLabs | Eingabe (Geheimnis) | Standard | alle |
| A13 Turn off a service for my account — AirLabs | Dienste `services` | AirLabs | Schalter | Standard | alle |
| C3 Service on/off — AirLabs | Dienste `services` | AirLabs | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Credential fields — AirLabs | Dienste `services` | AirLabs | Eingabe (Geheimnis) | Standard | nur Admin |
| C3 Allow account keys — AirLabs | Dienste `services` | AirLabs | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Test / A13 Test — AirLabs | Dienste `services` | AirLabs | Aktion | Standard | alle |
| C3 Quota / budget display — AirLabs | Dienste `services` | AirLabs | Status | Standard | nur Admin |
| C3 Aviationstack daily budget | Dienste `services` | Aviationstack | Eingabe | Standard | nur Admin |
| A13 Own API key per provider — Aviationstack | Dienste `services` | Aviationstack | Eingabe (Geheimnis) | Standard | alle |
| A13 Turn off a service for my account — Aviationstack | Dienste `services` | Aviationstack | Schalter | Standard | alle |
| C3 Service on/off — Aviationstack | Dienste `services` | Aviationstack | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Credential fields — Aviationstack | Dienste `services` | Aviationstack | Eingabe (Geheimnis) | Standard | nur Admin |
| C3 Allow account keys — Aviationstack | Dienste `services` | Aviationstack | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Test / A13 Test — Aviationstack | Dienste `services` | Aviationstack | Aktion | Standard | alle |
| C3 Quota / budget display — Aviationstack | Dienste `services` | Aviationstack | Status | Standard | nur Admin |
| A13 Own API key per provider — AeroDataBox | Dienste `services` | AeroDataBox | Eingabe (Geheimnis) | Standard | alle |
| A13 Turn off a service for my account — AeroDataBox | Dienste `services` | AeroDataBox | Schalter | Standard | alle |
| C3 Service on/off — AeroDataBox | Dienste `services` | AeroDataBox | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Credential fields — AeroDataBox | Dienste `services` | AeroDataBox | Eingabe (Geheimnis) | Standard | nur Admin |
| C3 Allow account keys — AeroDataBox | Dienste `services` | AeroDataBox | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Test / A13 Test — AeroDataBox | Dienste `services` | AeroDataBox | Aktion | Standard | alle |
| C3 Quota / budget display — AeroDataBox | Dienste `services` | AeroDataBox | Status | Standard | nur Admin |
| C3 AeroAPI plan tier | Dienste `services` | FlightAware AeroAPI | Auswahl (Liste) | Standard | nur Admin |
| C3 AeroAPI monthly USD limit | Dienste `services` | FlightAware AeroAPI | Eingabe | Standard | nur Admin |
| C3 AeroAPI fetch real tracks after arrival | Dienste `services` | FlightAware AeroAPI | Schalter | Standard | nur Admin |
| C3 Quota / budget display (AeroAPI monthly budget) | Dienste `services` | FlightAware AeroAPI | Status | Standard | nur Admin |
| C3 Service on/off — FlightAware AeroAPI | Dienste `services` | FlightAware AeroAPI | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Credential fields — FlightAware AeroAPI | Dienste `services` | FlightAware AeroAPI | Eingabe (Geheimnis) | Standard | nur Admin |
| C3 Test / A13 Test — FlightAware AeroAPI | Dienste `services` | FlightAware AeroAPI | Aktion | Standard | alle |
| A13 Own API key per provider (OpenSky client id) | Dienste `services` | OpenSky | Eingabe | Standard | alle |
| A13 Own API key per provider (OpenSky client secret) | Dienste `services` | OpenSky | Eingabe (Geheimnis) | Standard | alle |
| A13 OpenSky username (expert) | Dienste `services` | OpenSky | Eingabe | Experte | alle |
| A13 OpenSky password (expert) | Dienste `services` | OpenSky | Eingabe (Geheimnis) | Experte | alle |
| C3 Credential fields (OpenSky client id) | Dienste `services` | OpenSky | Eingabe | Standard | nur Admin |
| C3 Credential fields (OpenSky client secret) | Dienste `services` | OpenSky | Eingabe (Geheimnis) | Standard | nur Admin |
| C3 Credential fields (OpenSky username, expert) | Dienste `services` | OpenSky | Eingabe | Experte | nur Admin |
| C3 Credential fields (OpenSky password, expert) | Dienste `services` | OpenSky | Eingabe (Geheimnis) | Experte | nur Admin |
| A13 Turn off a service for my account — OpenSky | Dienste `services` | OpenSky | Schalter | Standard | alle |
| C3 Service on/off — OpenSky | Dienste `services` | OpenSky | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Allow account keys — OpenSky | Dienste `services` | OpenSky | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Test / A13 Test — OpenSky | Dienste `services` | OpenSky | Aktion | Standard | alle |
| C3 Quota / budget display — OpenSky | Dienste `services` | OpenSky | Status | Standard | nur Admin |
| C3 Service on/off — ADS-B Lol | Dienste `services` | ADS-B Lol | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Credential fields — ADS-B Lol | Dienste `services` | ADS-B Lol | Eingabe (Geheimnis) | Standard | nur Admin |
| C3 Test / A13 Test — ADS-B Lol | Dienste `services` | ADS-B Lol | Aktion | Standard | alle |
| C3 Quota / budget display — ADS-B Lol | Dienste `services` | ADS-B Lol | Status | Standard | nur Admin |
| C3 Service on/off — ADS-B Exchange | Dienste `services` | ADS-B Exchange | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Credential fields — ADS-B Exchange | Dienste `services` | ADS-B Exchange | Eingabe (Geheimnis) | Standard | nur Admin |
| C3 Test / A13 Test — ADS-B Exchange | Dienste `services` | ADS-B Exchange | Aktion | Standard | alle |
| C3 Quota / budget display — ADS-B Exchange | Dienste `services` | ADS-B Exchange | Status | Standard | nur Admin |
| C3 Service on/off — AISStream | Dienste `services` | AISStream | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Credential fields — AISStream | Dienste `services` | AISStream | Eingabe (Geheimnis) | Standard | nur Admin |
| A13 Own API key per provider — OpenRouteService | Dienste `services` | OpenRouteService | Eingabe (Geheimnis) | Standard | alle |
| A13 Turn off a service for my account — OpenRouteService | Dienste `services` | OpenRouteService | Schalter | Standard | alle |
| C3 Service on/off — OpenRouteService | Dienste `services` | OpenRouteService | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Credential fields — OpenRouteService | Dienste `services` | OpenRouteService | Eingabe (Geheimnis) | Standard | nur Admin |
| C3 Allow account keys — OpenRouteService | Dienste `services` | OpenRouteService | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Test / A13 Test — OpenRouteService | Dienste `services` | OpenRouteService | Aktion | Standard | alle |
| A13 Own API key per provider — GraphHopper | Dienste `services` | GraphHopper | Eingabe (Geheimnis) | Standard | alle |
| A13 Turn off a service for my account — GraphHopper | Dienste `services` | GraphHopper | Schalter | Standard | alle |
| C3 Service on/off — GraphHopper | Dienste `services` | GraphHopper | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Credential fields — GraphHopper | Dienste `services` | GraphHopper | Eingabe (Geheimnis) | Standard | nur Admin |
| C3 Allow account keys — GraphHopper | Dienste `services` | GraphHopper | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Test / A13 Test — GraphHopper | Dienste `services` | GraphHopper | Aktion | Standard | alle |
| C3 Rail timetables: Transitous switch | Dienste `services` | Transitous & db-rest | Schalter | Standard | nur Admin |
| C3 Rail timetables: db-rest switch | Dienste `services` | Transitous & db-rest | Schalter | Standard | nur Admin |
| C3 Rail timetables: lookup contact | Dienste `services` | Transitous & db-rest | Eingabe | Experte | nur Admin |
| C3 Service on/off — Google Places | Dienste `services` | Google Places | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Credential fields — Google Places | Dienste `services` | Google Places | Eingabe (Geheimnis) | Standard | nur Admin |
| C3 Test / A13 Test — Google Places | Dienste `services` | Google Places | Aktion | Standard | alle |
| C3 Geocoder: Photon URL | Dienste `services` | Photon & Nominatim | Eingabe | Experte | nur Admin |
| C3 Geocoder: Nominatim URL | Dienste `services` | Photon & Nominatim | Eingabe | Experte | nur Admin |
| C3 Geocoder: own geo server URL | Dienste `services` | Photon & Nominatim | Eingabe | Experte | nur Admin |
| C3 Always-on services — Photon & Nominatim | Dienste `services` | Photon & Nominatim | Status | Standard | alle |
| C3 Self-hosted routing: OSRM URL | Dienste `services` | OSRM & OpenRailRouting | Eingabe | Experte | nur Admin |
| C3 Self-hosted routing: OpenRailRouting URL | Dienste `services` | OSRM & OpenRailRouting | Eingabe | Experte | nur Admin |
| C3 Service on/off — OSRM & OpenRailRouting | Dienste `services` | OSRM & OpenRailRouting | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| A13 Immich connection (URL) | Dienste `services` | Immich | Eingabe · Gruppe | Standard | alle |
| A13 Immich connection (API key) | Dienste `services` | Immich | Eingabe (Geheimnis) · Gruppe | Standard | alle |
| A13 Nightly photo scan | Dienste `services` | Immich | Schalter · Gruppe | Standard | alle |
| E immichDefaultMode (Owner: Empfehlung 16) | Dienste `services` | Immich | Auswahl (Segment) · Gruppe | Standard | alle |
| E Link visit photos with Immich (Zweig …-397) | Dienste `services` | Immich | Aktion + Hintergrundaufgabe + Abhängigkeit | Standard | alle |
| C3 Immich instance connection (URL) | Dienste `services` | Immich | Eingabe · Gruppe | Standard | nur Admin |
| C3 Immich instance connection (API key) | Dienste `services` | Immich | Eingabe (Geheimnis) · Gruppe | Standard | nur Admin |
| A13 Turn off a service for my account — Immich | Dienste `services` | Immich | Schalter · Gruppe | Standard | alle |
| C3 What accounts may connect — Immich | Dienste `services` | Immich | Schalter · Gruppe | Standard | Admin: Regler · alle: Statuszeile |
| C3 Service on/off — Immich | Dienste `services` | Immich | Schalter · Gruppe | Standard | Admin: Regler · alle: Statuszeile |
| A13 Dawarich connection (URL) = A8 Dawarich connection | Dienste `services` | Dawarich | Eingabe · Gruppe | Standard | alle |
| A13 Dawarich connection (API key) | Dienste `services` | Dawarich | Eingabe (Geheimnis) · Gruppe | Standard | alle |
| C3 Dawarich instance connection (URL), R8 | Dienste `services` | Dawarich | Eingabe · Gruppe | Standard | nur Admin |
| C3 Dawarich instance connection (API key) | Dienste `services` | Dawarich | Eingabe (Geheimnis) · Gruppe | Standard | nur Admin |
| C3 Action: Sweep country days now | Dienste `services` | Dawarich | Aktion + Hintergrundaufgabe | Standard | nur Admin |
| A13 Turn off a service for my account — Dawarich | Dienste `services` | Dawarich | Schalter · Gruppe | Standard | alle |
| C3 What accounts may connect — Dawarich | Dienste `services` | Dawarich | Schalter · Gruppe | Standard | Admin: Regler · alle: Statuszeile |
| C3 Service on/off — Dawarich | Dienste `services` | Dawarich | Schalter · Gruppe | Standard | Admin: Regler · alle: Statuszeile |
| A13 Strava connection | Dienste `services` | Strava | Aktion | Standard | alle |
| C3 Strava app (client id) | Dienste `services` | Strava | Eingabe | Standard | nur Admin |
| C3 Strava app (client secret) | Dienste `services` | Strava | Eingabe (Geheimnis) | Standard | nur Admin |
| A13 Turn off a service for my account — Strava | Dienste `services` | Strava | Schalter | Standard | alle |
| C3 What accounts may connect — Strava | Dienste `services` | Strava | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Service on/off — Strava | Dienste `services` | Strava | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Ollama URL | Dienste `services` | Ollama | Eingabe | Experte | nur Admin |
| C4 Ollama model | Dienste `services` | Ollama | Auswahl (Liste) | Experte | nur Admin |
| C3/C4 Ollama vision model | Dienste `services` | Ollama | Auswahl (Liste) | Experte | nur Admin |
| C4 Action: Download a model | Dienste `services` | Ollama | Aktion + Hintergrundaufgabe | Experte | nur Admin |
| C3 Ollama remote opt-in | Dienste `services` | Ollama | Schalter | Standard | nur Admin |
| C3 Service on/off — Ollama | Dienste `services` | Ollama | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Test / A13 Test — Ollama | Dienste `services` | Ollama | Aktion | Standard | alle |
| A13 AI approval per provider — OpenAI | Dienste `services` | OpenAI | Aktion + Abhängigkeit | Standard | alle |
| C3 Consent to enable a cloud AI provider — OpenAI | Dienste `services` | OpenAI | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Credential fields — OpenAI | Dienste `services` | OpenAI | Eingabe (Geheimnis) | Standard | nur Admin |
| C3 Credential fields (model) — OpenAI | Dienste `services` | OpenAI | Eingabe | Experte | nur Admin |
| C3 Test / A13 Test — OpenAI | Dienste `services` | OpenAI | Aktion | Standard | alle |
| A13 AI approval per provider — Anthropic | Dienste `services` | Anthropic | Aktion + Abhängigkeit | Standard | alle |
| C3 Consent to enable a cloud AI provider — Anthropic | Dienste `services` | Anthropic | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Credential fields — Anthropic | Dienste `services` | Anthropic | Eingabe (Geheimnis) | Standard | nur Admin |
| C3 Credential fields (model) — Anthropic | Dienste `services` | Anthropic | Eingabe | Experte | nur Admin |
| C3 Test / A13 Test — Anthropic | Dienste `services` | Anthropic | Aktion | Standard | alle |
| A13 AI approval per provider — Google Gemini | Dienste `services` | Google Gemini | Aktion + Abhängigkeit | Standard | alle |
| C3 Consent to enable a cloud AI provider — Google Gemini | Dienste `services` | Google Gemini | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Credential fields — Google Gemini | Dienste `services` | Google Gemini | Eingabe (Geheimnis) | Standard | nur Admin |
| C3 Credential fields (model) — Google Gemini | Dienste `services` | Google Gemini | Eingabe | Experte | nur Admin |
| C3 Test / A13 Test — Google Gemini | Dienste `services` | Google Gemini | Aktion | Standard | alle |
| C3 Custom OpenAI-compatible base URL | Dienste `services` | OpenAI-kompatibel | Eingabe | Experte | nur Admin |
| A13 AI approval per provider — OpenAI-kompatibel | Dienste `services` | OpenAI-kompatibel | Aktion + Abhängigkeit | Standard | alle |
| C3 Consent to enable a cloud AI provider — OpenAI-kompatibel | Dienste `services` | OpenAI-kompatibel | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Credential fields — OpenAI-kompatibel | Dienste `services` | OpenAI-kompatibel | Eingabe (Geheimnis) | Standard | nur Admin |
| C3 Credential fields (model) — OpenAI-kompatibel | Dienste `services` | OpenAI-kompatibel | Eingabe | Experte | nur Admin |
| C3 Test / A13 Test — OpenAI-kompatibel | Dienste `services` | OpenAI-kompatibel | Aktion | Standard | alle |
| C3 Open data: Overpass URL | Dienste `services` | OpenStreetMap · Overpass | Eingabe | Experte | nur Admin |
| C3 Service on/off — OpenStreetMap · Overpass | Dienste `services` | OpenStreetMap · Overpass | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Logos: operator-logo lookup | Dienste `services` | Logostream | Schalter | Standard | nur Admin |
| C3/C7 Action: Refresh airline logos | Dienste `services` | Logostream | Aktion + Hintergrundaufgabe | Standard | nur Admin |
| C3 Service on/off — Logostream | Dienste `services` | Logostream | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C3 Credential fields — Logostream | Dienste `services` | Logostream | Eingabe (Geheimnis) | Standard | nur Admin |
| C3 Test / A13 Test — Logostream | Dienste `services` | Logostream | Aktion | Standard | alle |
| C3 FX: CDN fallback switch | Dienste `services` | EZB-Kurse | Schalter | Standard | nur Admin |
| C3 Always-on services — EZB-Kurse | Dienste `services` | EZB-Kurse | Status | Standard | alle |
| A13 WebDAV own target + A11 WebDAV URL | Dienste `services` | WebDAV | Eingabe · Gruppe | Standard | alle |
| A11 WebDAV user | Dienste `services` | WebDAV | Eingabe · Gruppe | Standard | alle |
| A11 WebDAV password | Dienste `services` | WebDAV | Eingabe (Geheimnis) · Gruppe | Standard | alle |
| A11 WebDAV folder | Dienste `services` | WebDAV | Eingabe · Gruppe | Experte | alle |
| C6 WebDAV off-site sync + C3 WebDAV backupSync | Dienste `services` | WebDAV | Schalter · Gruppe | Standard | nur Admin |
| C6 WebDAV URL (server) | Dienste `services` | WebDAV | Eingabe · Gruppe | Standard | nur Admin |
| C6 WebDAV user (server) | Dienste `services` | WebDAV | Eingabe · Gruppe | Standard | nur Admin |
| C6 WebDAV password (server) | Dienste `services` | WebDAV | Eingabe (Geheimnis) · Gruppe | Standard | nur Admin |
| C6 WebDAV backup path | Dienste `services` | WebDAV | Eingabe · Gruppe | Experte | nur Admin |
| A13 Turn off a service for my account — WebDAV | Dienste `services` | WebDAV | Schalter · Gruppe | Standard | alle |
| C3 What accounts may connect — WebDAV | Dienste `services` | WebDAV | Schalter · Gruppe | Standard | Admin: Regler · alle: Statuszeile |
| C3 Service on/off — WebDAV | Dienste `services` | WebDAV | Schalter · Gruppe | Standard | Admin: Regler · alle: Statuszeile |
| C5 Enable e-mail notifications | Dienste `services` | Mail (SMTP) | Schalter · Gruppe | Standard | nur Admin |
| C5 Host | Dienste `services` | Mail (SMTP) | Eingabe · Gruppe | Standard | nur Admin |
| C5 Username | Dienste `services` | Mail (SMTP) | Eingabe · Gruppe | Standard | nur Admin |
| C5 Password | Dienste `services` | Mail (SMTP) | Eingabe (Geheimnis) · Gruppe | Standard | nur Admin |
| C5 From address | Dienste `services` | Mail (SMTP) | Eingabe · Gruppe | Standard | nur Admin |
| C5 Port | Dienste `services` | Mail (SMTP) | Eingabe · Gruppe | Experte | nur Admin |
| C5 Secure (TLS) | Dienste `services` | Mail (SMTP) | Schalter · Gruppe | Experte | nur Admin |
| C5 From name | Dienste `services` | Mail (SMTP) | Eingabe · Gruppe | Experte | nur Admin |
| C5 Action: Test connection | Dienste `services` | Mail (SMTP) | Aktion | Standard | nur Admin |
| C5 Action: Delete credentials | Dienste `services` | Mail (SMTP) | Aktion (Gefahr) + Bestätigung | Standard | nur Admin |
| C8 Push to Companion | Dienste `services` | Push | Schalter | Standard | Admin: Regler · alle: Statuszeile |
| C8 Push consent record (R16) | Dienste `services` | Push | Status | Standard | nur Admin |
| C8 Relay address | Dienste `services` | Push | Eingabe | Experte | nur Admin |
| C8 Action: Reset push registration | Dienste `services` | Push | Aktion (Gefahr) + Bestätigung | Standard | nur Admin |
| C8 Connect to other servers | Dienste `services` | Andere Server | Schalter | Standard | nur Admin |
| C1 Trip sharing across servers + C8 Share trips with other servers | Dienste `services` | Andere Server | Schalter | Standard | nur Admin |
| C8 Public address of this server | Dienste `services` | Andere Server | Eingabe | Experte | nur Admin |
| C8 Server key | Dienste `services` | Andere Server | Aktion + Bestätigung | Standard | nur Admin |
| C8 Trusted servers + connection file actions | Dienste `services` | Andere Server | Liste + Aktion | Standard | nur Admin |
| C1 Anonymous usage statistics | Dienste `services` | Nutzungsstatistik | Auswahl (Segment) | Standard | nur Admin |
| C4 Update check | Dienste `services` | GitHub | Schalter | Standard | nur Admin |
| C4 Template repository | Dienste `services` | GitHub | Eingabe | Experte | nur Admin |
| C1 Instance name | Server `server` | Allgemein | Eingabe · Gruppe | Standard | nur Admin |
| C1 Sign-in page images | Server `server` | Allgemein | Aktion (Datei) | Standard | nur Admin |
| C1 Public URL | Server `server` | Adressen | Eingabe · Gruppe + Pflicht-Warnung | Standard | nur Admin |
| C1 Public URL for device pairing | Server `server` | Adressen | Eingabe · Gruppe | Standard | nur Admin |
| C1 Internal URL (LAN) | Server `server` | Adressen | Eingabe · Gruppe | Experte | nur Admin |
| C1 Passkey domain (rpId) | Server `server` | Passkeys | Eingabe · Gruppe | Experte | nur Admin |
| C1 Allowed origins | Server `server` | Passkeys | Eingabe · Gruppe | Experte | nur Admin |
| C1 Show beta features | Server `server` | Was der Server anbietet | Schalter | Standard | nur Admin |
| C1 TravTrack offered | Server `server` | Was der Server anbietet | Schalter | Standard | nur Admin |
| C1 TravPlan offered | Server `server` | Was der Server anbietet | Schalter | Standard | nur Admin |
| C1 TravPlan daily limits | Server `server` | Was der Server anbietet | Eingabe | Experte | nur Admin |
| C1 Country counting default | Server `server` | Was der Server anbietet | Auswahl (Liste) | Standard | nur Admin |
| C1 Import mode | Server `server` | Was der Server anbietet | Auswahl (Liste) | Standard | nur Admin |
| C4 Who reads first | Server `server` | Buchungen lesen | Auswahl (Segment) · Gruppe | Standard | nur Admin |
| C4 Use the AI model | Server `server` | Buchungen lesen | Schalter · Gruppe | Standard | nur Admin |
| C4 Cloud provider priority | Server `server` | Buchungen lesen | Liste + Aktion | Standard | nur Admin |
| C4 Built-in readers | Server `server` | Buchungen lesen | Status | Standard | nur Admin |
| C4 Action: Test Ollama connection | Server `server` | Buchungen lesen | Aktion | Standard | nur Admin |
| C1 Maximum users | Nutzer `users` | Zugang | Eingabe · Gruppe | Standard | nur Admin |
| C1 Allow public registration | Nutzer `users` | Zugang | Schalter · Gruppe | Standard | nur Admin |
| C2 User list + actions (deactivate, reset password, reset 2FA, delete) | Nutzer `users` | Konten | Liste + Aktion | Standard | nur Admin |
| C2 Invitation list + actions (create, by e-mail, copy, resend, revoke) | Nutzer `users` | Einladungen | Liste + Aktion | Standard | nur Admin |
| C6 Automatic backup | Sicherungen `backups` | Automatisch | Schalter · Gruppe | Standard | nur Admin |
| C6 Interval | Sicherungen `backups` | Automatisch | Auswahl (Segment) · Gruppe | Standard | nur Admin |
| C6 Retention | Sicherungen `backups` | Automatisch | Eingabe · Gruppe | Standard | nur Admin |
| C6 Time zone of backup hour | Sicherungen `backups` | Automatisch | Auswahl (Liste) · Gruppe | Standard | nur Admin |
| C6 Also delete expired from WebDAV | Sicherungen `backups` | Automatisch | Schalter · Gruppe + Abhängigkeit | Standard | nur Admin |
| C6 Action: Create backup now | Sicherungen `backups` | Vorhandene Sicherungen | Aktion + Hintergrundaufgabe | Standard | nur Admin |
| C6 Actions: Download / Upload / Delete / Restore | Sicherungen `backups` | Vorhandene Sicherungen | Liste + Aktion | Standard | nur Admin |
| C6 Action: Load backups from WebDAV | Sicherungen `backups` | Vorhandene Sicherungen | Aktion + Hintergrundaufgabe + Abhängigkeit | Standard | nur Admin |
| C7 Debug mode | Wartung `maintenance` | Protokoll | Schalter | Experte | nur Admin |
| C7 Log level | Wartung `maintenance` | Protokoll | Auswahl (Liste) | Experte | nur Admin |
| C7 Log retention | Wartung `maintenance` | Protokoll | Eingabe | Experte | nur Admin |
| C7 Log HTTP requests | Wartung `maintenance` | Protokoll | Schalter | Experte | nur Admin |
| C7 Log DB queries | Wartung `maintenance` | Protokoll | Schalter | Experte | nur Admin |
| C7 Log parser operations | Wartung `maintenance` | Protokoll | Schalter | Experte | nur Admin |
| C7 Log file list + viewer | Wartung `maintenance` | Protokoll | Sprung | Experte | nur Admin |
| C7 Action: cleanup old logs | Wartung `maintenance` | Protokoll | Aktion (Gefahr) + Bestätigung | Experte | nur Admin |
| C7 System: version and build | Wartung `maintenance` | System | Status | Experte | nur Admin |
| C7 Action: Download full backup (JSON) | Wartung `maintenance` | System | Aktion + Hintergrundaufgabe | Experte | nur Admin |
| C7/C3 Action: Re-seed catalogues | Wartung `maintenance` | System | Aktion (Gefahr) + Bestätigung + Hintergrundaufgabe | Experte | nur Admin |
| C7 Action: Delete demo user | Wartung `maintenance` | System | Aktion (Gefahr) + Bestätigung | Experte | nur Admin |
| C7 Time model: migration report | Wartung `maintenance` | Zeitzonen | Status | Experte | nur Admin |
| C7 Action: Re-resolve time zones | Wartung `maintenance` | Zeitzonen | Aktion + Hintergrundaufgabe | Experte | nur Admin |
| C7 Master data: airlines | Stammdaten `masterdata` | Kataloge | Sprung | Experte | nur Admin |
| C7 Master data: aircraft | Stammdaten `masterdata` | Kataloge | Sprung | Experte | nur Admin |
| C7 Master data: airports | Stammdaten `masterdata` | Kataloge | Sprung | Experte | nur Admin |
| C7 Master data: ships | Stammdaten `masterdata` | Kataloge | Sprung + Abhängigkeit | Experte | nur Admin |
| C7 Master data: ports | Stammdaten `masterdata` | Kataloge | Sprung + Abhängigkeit | Experte | nur Admin |
| C7 Master data: hotel chains (edit, merge, delete) | Stammdaten `masterdata` | Kataloge | Sprung | Experte | nur Admin |
| C1 About | Über TravStats `about` | Version | Status | Standard | alle |
| C1 About (build) | Über TravStats `about` | Version | Status | Experte | alle |
| A1 Settings level | Seitenleiste | — | Stufen-Umschaltung | — | alle |
| A1 Actions: Create/revoke API token, Sign out device, Disable 2FA, Regenerate recovery codes | Profil & Anmeldung `account` | API-Schlüssel / Companion-App / Anmeldung | Liste ⋯ + Bestätigung (`tokenrevoke`, `deviceout`, `codesnew`); 2FA aus mit Passwort | wie Zeile | alle (Demo gesperrt) |
| A2 Load state | Erinnerungen `notifications` | ganze Seite | EmptyState „degraded“ | Standard | alle |
| A3 Light/dark theme | — | — | nicht angeboten (Owner) | — | — |
| A6 Actions: Rename, Merge, Delete, Delete unused | Teilen `sharing` | Mitreisende | Liste ⋯ + Bestätigung (`merge`, `unused`) | Standard | alle |
| A7 Actions: Add/edit/delete card, Accept suggestion, Link chains | Treueprogramme `loyalty` | Karten | Liste ⋯ + Dialog | Standard | alle |
| A10 Seat statistics | — | — | gestrichen (Owner); Statistik-Blöcke im Kontext (B2) | — | — |
| A10 Show cruise routes on map | — | — | gestrichen (Owner); Kartenpanel (B1) | — | — |
| A12 Allow public links (Spiegel) | Teilen `sharing` | Öffentliche Links | zusammengelegt mit C1 | Standard | Admin: Regler · alle: Status |
| A13 Provided by the instance | Dienste `services` | jede Karte | Pille am Kartenkopf, Karte ohne Chevron | Standard | alle |
| A13 Search / category filter / „Info about X“ | Dienste `services` | Kopf | Chips + „?“ + globale Suche | Standard | alle |
| C2 Invitation actions | Nutzer `users` | Einladungen | Liste ⋯ (`invrevoke`) + Abhängigkeit `noSmtp` | Standard | nur Admin |
| C2 User actions: Deactivate, Reset password, Reset 2FA, Delete | Nutzer `users` | Konten | Liste ⋯ (`userlock`, `userpw`, `user2fa`, `userdel`) | Standard | nur Admin |
| C3 WebDAV Test | Dienste `services` | WebDAV | „Speichern & testen“ der Gruppe | Standard | alle / Admin |
| C4 Boarding-pass parser strategy | — | — | nicht angeboten (Owner) | — | — |
| C6 Restore, Delete backup | Sicherungen `backups` | Vorhandene Sicherungen | ⋯ + Bestätigung (`restore` mit Tippwort, `bakdel`) + Hintergrundaufgabe | Standard | nur Admin |
| C7 Logging: max file size, rotated files | — | — | nicht angeboten (Owner) | — | — |
| C7 Master data: Add entry; hotel chains edit/merge/delete | Stammdaten `masterdata` | Katalog | Liste + Dialog | Experte | nur Admin |
| C8 Actions: Pin/verify/suspend/remove peer, connection file | Dienste `services` | Andere Server | Liste ⋯ (`peerremove`) | Standard | nur Admin |
| E Account deletion | Profil & Anmeldung `account` | Konto löschen | B17 | Standard | alle (Demo gesperrt) |

## 5. Texte Deutsch / Englisch

### 5.1 Einstellungen

| Inventar | Name | Kurzzeile | Hilfe | Name EN | Kurzzeile EN | Hilfe EN |
|---|---|---|---|---|---|---|
| A1 Profile picture | Profilbild | PNG oder JPG, bis 5 MB |  | Profile picture | PNG or JPG, up to 5 MB |  |
| A1 First name | Vorname |  |  | First name |  |  |
| A1 Last name | Nachname |  |  | Last name |  |  |
| A1 Username | Benutzername | Zum Anmelden, bleibt fest |  | Username | For signing in, can't change |  |
| A1 E-mail address (profile) | E-Mail | Für ein neues Passwort | Erinnerungen haben eine eigene Adresse unter Erinnerungen. | E-mail | For a new password | Reminders use their own address under Reminders. |
| A1 Birthday | Geburtstag | Optional | Schaltet den Erfolg „Geburtstagsflug“ frei. | Birthday | Optional | Unlocks the “Birthday flight” achievement. |
| A10 Home (residence, periods) + A10 Home place | Wohnort | Von hier misst TravStats Entfernungen | Ein Umzug beginnt einen neuen Zeitraum, nichts wird überschrieben. Alte Reisen zählen gegen den Wohnort ihres Tages. Der aktuelle Wohnort ist auch dein Heimatort in der Companion-App. | Home town | Distances are measured from here | A move starts a new period, nothing is overwritten. Old trips count against the home of their day. Your current home is also your home in the Companion app. |
| A10 Home country | Heimatland | Buchungsvorlagen von hier zuerst | Filtert nichts, ändert nur die Reihenfolge. | Home country | Booking templates from here first | Filters nothing, only changes the order. |
| A10 Passport valid until | Reisepass gültig bis | Die Companion-App warnt 6 Monate vorher |  | Passport valid until | The Companion app warns 6 months ahead |  |
| A1 Password | Passwort |  |  | Password |  |  |
| A1 Two-factor authentication (TOTP) | Zweiter Faktor | Code aus einer Authenticator-App | API-Schlüssel umgehen den zweiten Faktor. Ein Passkey ersetzt Passwort und zweiten Faktor. | Two-step sign-in | Code from an authenticator app | API keys bypass the second step. A passkey replaces both password and second step. |
| A1 Recovery codes | Ersatzcodes | Falls das Telefon fehlt | Neue Codes machen die alten wertlos. Du siehst sie nur einmal. | Backup codes | In case your phone is missing | New codes void the old ones. You see them only once. |
| A1 Passkeys | Passkeys | Anmelden ohne Passwort | Ein Passkey ersetzt Passwort und zweiten Faktor. Er gilt nur unter der Adresse, unter der du ihn angelegt hast. | Passkeys | Sign in without a password | A passkey replaces password and second step. It only works at the address where you created it. |
| A1 Paired devices (Companion app) | Gekoppelte Telefone |  | Der Kopplungscode verfällt nach wenigen Minuten. Abmelden nimmt dem Telefon sofort den Zugang. | Paired phones |  | The pairing code expires after a few minutes. Signing out removes the phone's access at once. |
| A1 API tokens | API-Schlüssel | Für Skripte und Werkzeuge | Ein Schlüssel umgeht den zweiten Faktor. Du siehst ihn nur beim Anlegen. Zurückziehen sperrt das Werkzeug sofort aus. | API keys | For scripts and tools | A key bypasses the second step. You see it only once. Revoking locks the tool out at once. |
| E Account deletion (Owner: wird gebaut) | Konto löschen | Mit allen Einträgen, Fotos und Dateien | Nach der Bestätigung ist alles sofort weg, auch für den Admin. Vorher kannst du deine Daten herunterladen. | Delete account | With all entries, photos and files | After you confirm, everything is gone at once, for your admin too. You can download your data first. |
| A3 Language | Sprache |  |  | Language |  |  |
| A3 Time zone | Zeitzone | Für Ortszeiten und Tageswerte |  | Time zone | For local times and daily values |  |
| A3 Date format | Datum | Tabellen zeigen immer 2026-12-31 |  | Date | Tables always show 2026-12-31 |  |
| A3 Time format | Uhrzeit |  |  | Time |  |  |
| A3 Distance unit | Entfernung |  |  | Distance |  |  |
| A3 Weight unit | Gepäck | Für Freigepäck ohne Einheit | Rechnet nichts um. | Baggage | For allowances without a unit | Converts nothing. |
| A3 Base currency | Hauptwährung | Alle Summen in dieser Währung | Schon umgerechnete Beträge behalten ihren Wert. Kurse der EZB ab 1999. | Main currency | All totals in this currency | Amounts already converted keep their value. ECB rates back to 1999. |
| A9 Map appearance link + A3 Map theme | Kartendarstellung | Stil, Linien, Beschriftungen |  | Map look | Style, lines, labels |  |
| A9 Dashboard link | Startseite | Reisearten und Kartenart |  | Home page | Travel types and map mode |  |
| A9 Lists link | Listen | Spalten, Sortierung, Seitengröße |  | Lists | Columns, sorting, page size |  |
| A4 Domain on/off + Domain colour (flight) | Flüge |  |  | Flights |  |  |
| A4 Domain on/off + Domain colour (cruise) | Kreuzfahrten |  |  | Cruises |  |  |
| A4 Domain on/off + Domain colour (lodging) | Unterkünfte |  |  | Stays |  |  |
| A4 Domain on/off + Domain colour (poi) | Orte |  |  | Places |  |  |
| A4 Domain on/off + Domain colour (rail) | Bahn |  |  | Rail |  |  |
| A4 Domain on/off + Domain colour (bus) | Bus |  |  | Bus |  |  |
| A4 Domain on/off + Domain colour (ferry) | Fähre |  |  | Ferry |  |  |
| A4 Domain on/off + Domain colour (rental) | Mietwagen |  |  | Rental cars |  |  |
| A4 Domain on/off + Domain colour (roadtrip/tour) | Touren | Wandern, Rad, Roadtrip |  | Tours | Hiking, cycling, road trips |  |
| A4 Action: reset colours | Farben zurücksetzen |  | Die Karte hat eigene Farben und bleibt, wie sie ist. | Reset colours |  | The map has its own colours and stays as it is. |
| A4 TravPlan on/off | Reisen planen | Ideen und Pläne vor der Reise | Ausschalten behält deine Pläne. | Plan trips | Ideas and plans before you go | Turning off keeps your plans. |
| A4 Country counting threshold | Ein Land zählt ab |  | übernachtet: mindestens eine Nacht · besucht: ein Ort dort · durchreist: am Boden gewesen · umgestiegen: auch nur beim Umsteigen. | A country counts from |  | stayed overnight: at least one night · visited: a place there · passed through: on the ground · changed planes: even a connection. |
| A10 Home (home airports) | Heimatflughäfen | Bis zu drei, einer als Standard | Sie gehören zum aktuellen Wohnort. Ziehst du um, bleiben die alten mit ihrem Zeitraum. | Home airports | Up to three, one as default | They belong to your current home. When you move, the old ones keep their period. |
| A10 Flight defaults — status | Status |  |  | Status |  |  |
| A10 Flight defaults — seat class | Klasse |  |  | Class |  |  |
| A10 Flight defaults — favourite airline | Airline |  |  | Airline |  |  |
| A10 Flight defaults — category | Anlass | Nur für Statistiken |  | Purpose | Statistics only |  |
| A10 Cost tracking | Steuern und Gebühren | Auch Geschäftsreise-Summen | Preis und Währung gibt es immer. | Taxes and fees | Also business-travel totals | Price and currency are always there. |
| A10 Track tail numbers | Kennzeichen der Maschine |  | Aus: nur Flugzeugtypen, keine einzelnen Maschinen. | Aircraft registration |  | Off: aircraft types only, no individual aircraft. |
| A10 Live tracking | Flugweg vom Telefon | Die Companion-App zeichnet ihn auf | Aus: Der Server nimmt keine Flugwege mehr an. | Flight path from phone | Recorded by the Companion app | Off: the server stops accepting flight paths. |
| A10 Automatic updates | Live-Updates abrufen | Während ein Flug unterwegs ist |  | Fetch live updates | While a flight is under way |  |
| A10 Require approval for updates | Updates erst nach Freigabe |  |  | Approve updates first |  |  |
| A10 Update expiry | Offene Updates verwerfen nach | 1 bis 168 Stunden |  | Drop open updates after | 1 to 168 hours |  |
| A10 Action: View pending updates | Offene Updates |  |  | Open updates |  |  |
| A10 Historical enrichment | Ältere Flüge ergänzen | Aus Live-Flügen mit derselben Nummer | Es entstehen nur Vorschläge im Eingang. | Fill in older flights | From live flights with the same number | Only creates suggestions in the inbox. |
| A10 Enrichment min. confidence | Mindestens sicher | 0–100 % |  | Minimum confidence | 0–100 % |  |
| A10 Enrichment max per day | Vorschläge pro Nacht | 1–1000 |  | Suggestions per night | 1–1000 |  |
| A10 Action: Enrich | Passende Flüge | 12 lassen sich ergänzen |  | Matching flights | 12 can be filled in |  |
| A10 Cruise — default line | Reederei |  |  | Cruise line |  |  |
| A10 Cruise — default cabin category | Kabine |  |  | Cabin |  |  |
| A10 Count sea days | Seetage als Reisetage |  | Die Zahl der Seetage bleibt sichtbar. | Sea days count as travel days |  | The number of sea days stays visible. |
| A5 Create trips automatically on import | Reisen beim Import bilden | Gleiche Buchungsnummer, eine Reise |  | Group trips on import | Same booking reference, one trip |  |
| A5 Default colour for new trips | Farbe neuer Reisen |  |  | Colour of new trips |  |  |
| A5 Trip suggestions | Reisen vorschlagen |  | Aus: Es wird nichts mehr berechnet. Deine Entscheidungen bleiben. | Suggest trips |  | Off: nothing is computed. Your decisions stay. |
| A5 Stay suggestions | Aufenthalte vorschlagen | Aus deinem Standortverlauf |  | Suggest stays | From your location history |  |
| A5 Immich photos as place evidence | Immich-Fotos als Beleg |  |  | Immich photos as evidence |  |  |
| A5 AI place-type classification | Ortsart per KI erkennen | Nur Ortsnamen, keine Koordinaten |  | Detect place type with AI | Place names only, no coordinates |  |
| A5 Calendar subscription link | Kalender-Abo | Deine Reisen in jeder Kalender-App | Den Link siehst du nur beim Erstellen. Neu erzeugen beendet alte Abos. Google Kalender braucht eine öffentliche Adresse des Servers. | Calendar feed | Your trips in any calendar app | You see the link only once. Regenerating ends old subscriptions. Google Calendar needs a public server address. |
| A6 Companion list | Personen | Umbenennen, zusammenführen, löschen | Zusammenführen ändert jeden Eintrag mit dieser Person und lässt sich nicht zurücknehmen. | People | Rename, merge, delete | Merging changes every entry with this person and can't be undone. |
| A5 Trip sharing — requests | Reisen teilen |  | Zurückziehen beendet das Abgleichen. Schon Geteiltes bleibt als eigene Kopie. | Share trips |  | Withdrawing stops syncing. What's shared stays as an own copy. |
| A5 Link companion to account | Person mit Konto verknüpfen | Nötig, bevor ihr teilt |  | Link person to account | Needed before you share |  |
| A5 Cross-server sharing — invitation codes | Einladungscode | Gilt einmal, verfällt | Einen Code von anderen löst du hier auch ein. | Invitation code | Single use, expires | You redeem someone else's code here too. |
| C1 Public links permission + A12 Allow public links | Öffentliche Links erlauben |  | Ausschalten zieht sofort alle Links aller Konten zurück. | Allow public links |  | Turning off revokes every link of every account at once. |
| A12 Public links list | Deine Links | Erstellt an Flug, Reise oder Jahr |  | Your links | Created on a flight, trip or year |  |
| A12 Comparison consent | Rangliste | Wer deine Summen sieht |  | Leaderboard | Who sees your totals |  |
| A12 Encrypted sharing grants | Verschlüsselt übergeben | Ganze Einträge an ein anderes Konto |  | Hand over encrypted | Full entries to another account |  |
| A2 Reminder e-mail address | Mail an | Leer: keine Mails |  | Mail to | Empty: no mail |  |
| A2 Channel per area (App-Verfügbarkeit, R14) | Mitteilungen an die App |  | Bereit, sobald ein gekoppeltes Telefon Mitteilungen erlaubt. Der Server muss sie außerdem senden dürfen. | Notifications to the app |  | Ready as soon as one paired phone allows notifications. The server must also be allowed to send them. |
| A2 Reminders on/off + Lead times + Channel (flight) | Flug |  | Bis zu einer eigenen Zeit, ganze Stunden von 1 bis 168. | Flight |  | Plus one own time, whole hours from 1 to 168. |
| A2 Reminders (cruise) | Kreuzfahrt |  |  | Cruise |  |  |
| A2 Reminders (rail) | Bahn |  |  | Rail |  |  |
| A2 Reminders (bus) | Bus |  |  | Bus |  |  |
| A2 Reminders (ferry) | Fähre |  |  | Ferry |  |  |
| A2 Reminders (lodging) | Unterkunft |  |  | Stay |  |  |
| A8 Location source + A8 Use Dawarich hint | Standort kommt von | Für Ländertage, Aufenthalte, Routen | Umschalten verschiebt und löscht nichts. TravTrack speichert auf diesem Server. Dawarich geht nur mit deiner eigenen Dawarich-Verbindung. | Location comes from | For country days, stays, routes | Switching moves and deletes nothing. TravTrack stores on this server. Dawarich only works with your own Dawarich connection. |
| A8 Dawarich connection (pointer) | Deine Dawarich-Verbindung |  |  | Your Dawarich connection |  |  |
| A8 Trip recording | Reisen aufzeichnen | Positionen aus der Companion-App | Aus: Der Server nimmt keine neuen Positionen an. Gespeicherte bleiben. | Record trips | Positions from the Companion app | Off: the server accepts no new positions. Stored ones stay. |
| A8 Stay scan — detect stays automatically | Automatisch suchen | Alle 6 Stunden, auch Märkte, Parks, Museen | Funde landen als Vorschlag im Eingang. Pausiert, solange Orte oder Aufenthaltsvorschläge aus sind. | Search automatically | Every 6 hours, also markets, parks, museums | Finds arrive as inbox suggestions. Paused while Places or stay suggestions are off. |
| A8 Scan period | Zeitraum für „Jetzt suchen“ |  |  | Period for “Search now” |  |  |
| A8 Action: Scan now | Jetzt suchen |  |  | Search now |  |  |
| A8 TravTrack summary | Gespeichert |  |  | Stored |  |  |
| A8 Privacy zones | Schutzzonen | Hier wird nichts gespeichert | Eine neue Zone löscht Punkte, die schon darin liegen; vorher siehst du, wie viele. Entfernen holt nichts zurück. | Privacy zones | Nothing is stored here | A new zone deletes points already inside; you see how many first. Removing brings nothing back. |
| A8 City lookup in monthly values | Städte benennen | Orte ab 30 Minuten | Sendet auf 1 km gerundete Positionen an die Ortssuche des Servers. Aus entfernt die Städte wieder. | Name cities | Places from 30 minutes | Sends positions rounded to 1 km to the server's place search. Off removes the cities again. |
| A8 Further sources (OwnTracks / Overland keys) | Weitere Apps | OwnTracks und Overland | Diese Apps kennen deine Schutzzonen nicht; der Server verwirft Punkte darin. Den Schlüssel siehst du nur einmal. | Other apps | OwnTracks and Overland | These apps don't know your privacy zones; the server drops points inside. You see the key only once. |
| A8 Copy Dawarich history | Aus Dawarich übernehmen | Ganz oder ein Zeitraum | Braucht deine eigene Dawarich-Verbindung. Lässt sich anhalten und fortsetzen. | Copy from Dawarich | All or a period | Needs your own Dawarich connection. Can be paused and resumed. |
| A8 GPX imports (history) | GPX-Dateien |  |  | GPX files |  |  |
| A8 Export history | Verlauf exportieren | GPX oder JSON |  | Export history | GPX or JSON |  |
| A8 Delete a span | Tage löschen |  | Gelöschte Tage bleiben gelöscht, auch wenn ein Telefon sie später nachreicht. | Delete days |  | Deleted days stay deleted, even if a phone sends them later. |
| A8 Diagnostics | Diagnose | Warum Punkte fehlen | Braucht das Diagnose-Protokoll in der Companion-App. | Diagnostics | Why points are missing | Needs the diagnostics log in the Companion app. |
| A7 Programme cards (airline) | Airlines |  | Vorschläge aus deinen Flügen erscheinen hier zum Übernehmen. | Airlines |  | Suggestions from your flights show up here to accept. |
| A7 Programme cards (lodging) | Hotels | Ketten und einzelne Häuser |  | Hotels | Chains and single hotels |  |
| A7 Programme cards (rail) | Bahn |  |  | Rail |  |  |
| A7 Programme cards (cruise) | Reedereien |  |  | Cruise lines |  |  |
| A11 Instance backup status + A11 Backup extra row (R3: „Letzte Instanz-Sicherung“) | Letzte Sicherung des Servers | Kümmert sich der Admin drum |  | Last server backup | Your admin takes care of it |  |
| A11 WebDAV sync (own storage) | Eigene Kopie auf WebDAV | Dein Export, regelmäßig | Die Verbindung richtest du unter Dienste → Backup-Ziel ein. | Own copy on WebDAV | Your export, on a schedule | Set up the connection under Services → Backup target. |
| A11 WebDAV sync — schedule | Wie oft |  |  | How often |  |  |
| A11 WebDAV sync — versions to keep | Versionen behalten | 1–30 |  | Versions to keep | 1–30 |  |
| A11 Action: WebDAV Sync now | Jetzt hochladen |  |  | Upload now |  |  |
| A11 Download my data | Alle meine Daten | JSON, ohne Passwörter und Schlüssel | Fotos und Dokumente sind nicht dabei. | All my data | JSON, without passwords or keys | Photos and documents aren't included. |
| A11 Excel export | Excel-Tabelle | Ein Blatt pro Reiseart | Lässt sich bearbeiten und wieder einlesen, auch in ein anderes Konto. | Excel sheet | One sheet per travel type | Edit it and read it back in, also into another account. |
| A11 Recordings as GPX | Aufzeichnungen | Alle Touren als GPX im ZIP |  | Recordings | All tours as GPX in a ZIP |  |
| A11 Import lists hub | Listen importieren | CSV, Flightradar24, andere Apps |  | Import lists | CSV, Flightradar24, other apps |  |
| A11 Excel import | Excel-Tabelle einlesen | Mit Vorschau | Hinzufügen · Abgleichen · Ersetzen. Ersetzen betrifft jedes Blatt der Datei mit mindestens einer Zeile und löscht dort, was in der Datei fehlt. Vorher lege ich eine Sicherung des ganzen Servers an. | Read Excel sheet | With preview | Add · Merge · Replace. Replace affects every sheet in the file with at least one row and deletes what the file doesn't mention there. I take a backup of the whole server first. |
| A11 Read GPX / TCX / FIT / ZIP | Aufzeichnungen einlesen | GPX, TCX, FIT oder ZIP | ZIP bis 500 Dateien und 200 MB, eine Aufzeichnung bis 15 MB. | Read recordings | GPX, TCX, FIT or ZIP | ZIP up to 500 files and 200 MB, one recording up to 15 MB. |
| A11 Import log | Bisherige Importe | Ganz zurücknehmen | Einträge, auf die schon anderes verweist, bleiben; ich sage, welche. | Past imports | Undo as a whole | Entries something else already points to stay; I'll say which. |
| A11 Rail import: U-Bahn/tram legs | U-Bahn und Tram | Vorauswahl, im Import änderbar |  | Metro and tram | Preselection, changeable per import |  |
| A11 Rail import: bus legs | Busabschnitte |  |  | Bus legs |  |  |
| C3 Aviationstack daily budget | Anfragen pro Tag | 0 schaltet ab |  | Requests per day | 0 turns it off |  |
| C3 AeroAPI plan tier | Tarif |  |  | Plan |  |  |
| C3 AeroAPI monthly USD limit | Monatsgrenze in USD | Nur beim eigenen Tarif |  | Monthly limit in USD | Custom plan only |  |
| C3 AeroAPI fetch real tracks after arrival | Echte Flugwege nach der Landung | Kostet zusätzliche Anfragen |  | Real tracks after landing | Costs extra requests |  |
| C3 Quota / budget display (AeroAPI monthly budget) | Verbraucht diesen Monat |  | TravStats hört vor der Grenze auf. | Used this month |  | TravStats stops before the limit. |
| A13 Own API key per provider (OpenSky client id) | Deine Client-ID | Statt der des Servers |  | Your client ID | Instead of the server's |  |
| A13 Own API key per provider (OpenSky client secret) | Dein Client-Secret |  | Wird verschlüsselt gespeichert und nie wieder angezeigt. | Your client secret |  | Stored encrypted and never shown again. |
| A13 OpenSky username (expert) | Dein Benutzername | Altes Anmeldeverfahren |  | Your username | Legacy sign-in |  |
| A13 OpenSky password (expert) | Dein Passwort | Altes Anmeldeverfahren |  | Your password | Legacy sign-in |  |
| C3 Credential fields (OpenSky client id) | Client-ID des Servers | Für alle Konten ohne eigene |  | Server client ID | For every account without its own |  |
| C3 Credential fields (OpenSky client secret) | Client-Secret des Servers |  |  | Server client secret |  |  |
| C3 Credential fields (OpenSky username, expert) | Benutzername des Servers | Altes Anmeldeverfahren |  | Server username | Legacy sign-in |  |
| C3 Credential fields (OpenSky password, expert) | Passwort des Servers | Altes Anmeldeverfahren |  | Server password | Legacy sign-in |  |
| C3 Rail timetables: Transitous switch | Transitous | Fahrpläne aus offenen Daten |  | Transitous | Timetables from open data |  |
| C3 Rail timetables: db-rest switch | db-rest | Fahrpläne der Deutschen Bahn |  | db-rest | Deutsche Bahn timetables |  |
| C3 Rail timetables: lookup contact | Kontakt für Anfragen | Wird den Betreibern mitgeschickt |  | Contact for requests | Sent along to the operators |  |
| C3 Geocoder: Photon URL | Photon-Adresse |  |  | Photon address |  |  |
| C3 Geocoder: Nominatim URL | Nominatim-Adresse |  |  | Nominatim address |  |  |
| C3 Geocoder: own geo server URL | Eigener Geo-Server |  |  | Own geo server |  |  |
| C3 Self-hosted routing: OSRM URL | OSRM-Adresse | Leer: aus |  | OSRM address | Empty: off |  |
| C3 Self-hosted routing: OpenRailRouting URL | OpenRailRouting-Adresse | Leer: aus |  | OpenRailRouting address | Empty: off |  |
| A13 Immich connection (URL) | Adresse |  | Darf im eigenen Netz liegen. | Address |  | May be on your local network. |
| A13 Immich connection (API key) | API-Schlüssel | Aus Immich → Konto → API-Schlüssel |  | API key | From Immich → Account → API keys |  |
| A13 Nightly photo scan | Fotos jede Nacht durchsehen | Findet Reisen, die noch fehlen |  | Look through photos nightly | Finds trips you haven't logged |  |
| E immichDefaultMode (Owner: Empfehlung 16) | Fotos an Reisen |  | Verknüpfen zeigt die Fotos aus Immich und kopiert nichts. Kopieren lädt die Originale auf diesen Server. | Photos on trips |  | Link shows photos from Immich and copies nothing. Copy downloads the originals to this server. |
| E Link visit photos with Immich (Zweig …-397) | Besuchsfotos verknüpfen | Fotos zu deinen Orten suchen |  | Link visit photos | Find photos for your places |  |
| C3 Immich instance connection (URL) | Immich des Servers: Adresse | Für Konten ohne eigene Verbindung |  | Server's Immich: address | For accounts without their own |  |
| C3 Immich instance connection (API key) | Immich des Servers: API-Schlüssel |  |  | Server's Immich: API key |  |  |
| A13 Dawarich connection (URL) = A8 Dawarich connection | Adresse |  |  | Address |  |  |
| A13 Dawarich connection (API key) | API-Schlüssel |  | Deine Verbindung ist die einzige, die Standortquelle, Aufenthaltssuche und Ländertage nutzen. | API key |  | Your connection is the only one used for location source, stay search and country days. |
| C3 Dawarich instance connection (URL), R8 | Dawarich des Servers: Adresse | Nur für Tracks von Touren und Kreuzfahrten | Standortquelle, Aufenthalte und Ländertage brauchen die eigene Verbindung jedes Kontos. Sonst sähen alle Konten die Bewegungen eines Menschen. | Server's Dawarich: address | Only for tour and cruise tracks | Location source, stays and country days need each account's own connection. Otherwise every account would see one person's movements. |
| C3 Dawarich instance connection (API key) | Dawarich des Servers: API-Schlüssel |  |  | Server's Dawarich: API key |  |  |
| C3 Action: Sweep country days now | Ländertage jetzt zählen | Für jedes Konto mit eigener Verbindung | Läuft sonst jede Nacht. Kann einige Minuten dauern. | Count country days now | For every account with its own connection | Otherwise runs nightly. May take a few minutes. |
| A13 Strava connection | Mit Strava verbinden |  | Strava-Daten gehen nie an eine KI. | Connect Strava |  | Strava data never goes to an AI. |
| C3 Strava app (client id) | Client-ID der Strava-App | Einmal für den Server registriert |  | Strava app client ID | Registered once for the server |  |
| C3 Strava app (client secret) | Client-Secret der Strava-App |  |  | Strava app client secret |  |  |
| C3 Ollama URL | Adresse |  |  | Address |  |  |
| C4 Ollama model | Modell |  |  | Model |  |  |
| C3/C4 Ollama vision model | Modell für Bilder |  |  | Model for images |  |  |
| C4 Action: Download a model | Modell auf den Server laden |  |  | Download model to server |  |  |
| C3 Ollama remote opt-in | Liegt außerhalb dieses Netzes | Dann stimmt jedes Konto selbst zu |  | Runs outside this network | Then each account agrees on its own |  |
| C3 Custom OpenAI-compatible base URL | Adresse mit Versionspfad | z. B. …/v1 |  | Address with version path | e.g. …/v1 |  |
| C3 Open data: Overpass URL | Overpass-Adresse |  |  | Overpass address |  |  |
| C3 Logos: operator-logo lookup | Logos von Betreibern suchen |  |  | Look up operator logos |  |  |
| C3/C7 Action: Refresh airline logos | Logos neu laden | Passiert auch jede Nacht |  | Reload logos | Also happens every night |  |
| C3 FX: CDN fallback switch | Ersatzquelle | Wenn die EZB nicht antwortet |  | Fallback source | When the ECB doesn't answer |  |
| A13 WebDAV own target + A11 WebDAV URL | Adresse | Öffentliche https-Adresse |  | Address | Public https address |  |
| A11 WebDAV user | Benutzer |  |  | User |  |  |
| A11 WebDAV password | Passwort |  |  | Password |  |  |
| A11 WebDAV folder | Ordner |  |  | Folder |  |  |
| C6 WebDAV off-site sync + C3 WebDAV backupSync | Server-Sicherungen hochladen | Jede gelungene Sicherung |  | Upload server backups | Every successful backup |  |
| C6 WebDAV URL (server) | Server: Adresse |  |  | Server: address |  |  |
| C6 WebDAV user (server) | Server: Benutzer |  |  | Server: user |  |  |
| C6 WebDAV password (server) | Server: Passwort |  | Wird verschlüsselt gespeichert. Erst speichern, dann testen. | Server: password |  | Stored encrypted. Save first, then test. |
| C6 WebDAV backup path | Ordner für Server-Sicherungen |  |  | Folder for server backups |  |  |
| C5 Enable e-mail notifications | Mails verschicken | Einladungen, Erinnerungen, neues Passwort |  | Send mail | Invitations, reminders, new password |  |
| C5 Host | Server |  |  | Server |  |  |
| C5 Username | Benutzer |  |  | User |  |  |
| C5 Password | Passwort | Gmail und Outlook brauchen ein App-Passwort |  | Password | Gmail and Outlook need an app password |  |
| C5 From address | Absender | Am besten aus derselben Domain |  | Sender | Ideally from the same domain |  |
| C5 Port | Port | 587 mit STARTTLS, 465 mit TLS |  | Port | 587 with STARTTLS, 465 with TLS |  |
| C5 Secure (TLS) | Direkt verschlüsselt (TLS) |  |  | Encrypted from the start (TLS) |  |  |
| C5 From name | Absendername |  |  | Sender name |  |  |
| C5 Action: Test connection | Verbindung prüfen |  |  | Check connection |  |  |
| C5 Action: Delete credentials | Zugangsdaten löschen |  | Danach verschickt der Server gar keine Mails mehr. | Delete credentials |  | After that the server sends no mail at all. |
| C8 Push to Companion | Mitteilungen senden | Über den Push-Dienst von TravStats | Aus: Der Server meldet sich nie beim Push-Dienst. | Send notifications | Through the TravStats push service | Off: the server never contacts the push service. |
| C8 Push consent record (R16) | Zugestimmt am |  | Der Push-Dienst erfährt die Kennung des Telefons und den Text der Mitteilung, sonst nichts. | Agreed on |  | The push service learns the phone's ID and the notification text, nothing else. |
| C8 Relay address | Adresse des Push-Dienstes |  | Eine andere Adresse meldet den Server neu an. | Push service address |  | A different address registers the server again. |
| C8 Action: Reset push registration | Anmeldung zurücksetzen |  |  | Reset registration |  |  |
| C8 Connect to other servers | Mit anderen Servern verbinden |  |  | Connect to other servers |  |  |
| C1 Trip sharing across servers + C8 Share trips with other servers | Reisen mit anderen Servern teilen |  |  | Share trips with other servers |  |  |
| C8 Public address of this server | Adresse dieses Servers | https, ohne Port und Pfad |  | This server's address | https, no port or path |  |
| C8 Server key | Server-Schlüssel |  | Ein neuer Schlüssel trennt alle Verbindungen, bis die anderen ihn neu bestätigen. | Server key |  | A new key cuts all connections until the others confirm it again. |
| C8 Trusted servers + connection file actions | Vertraute Server |  | Eine eingelesene Datei vertraut noch niemandem, erst „Vertrauen“ tut es. | Trusted servers |  | An imported file trusts no one yet; only “Trust” does. |
| C1 Anonymous usage statistics | Nutzungsstatistik senden | Einmal am Tag, ohne Namen | Die Installations-ID steht in der Hilfe. Ist der Empfänger beim Start abgeschaltet, geht nichts raus. | Send usage statistics | Once a day, without names | The install ID is shown in the help. If the receiver is disabled at start, nothing is sent. |
| C4 Update check | Nach neuen Versionen suchen | Fragt GitHub |  | Check for new versions | Asks GitHub |  |
| C4 Template repository | Quelle der Buchungsvorlagen | Leer: offizielle Quelle |  | Booking template source | Empty: official source |  |
| C1 Instance name | Name | In Mails und Sicherungen |  | Name | In e-mails and backups |  |
| C1 Sign-in page images | Bilder der Anmeldeseite | Sieht jeder, auch ohne Anmeldung | Alle entfernen bringt die mitgelieferten zurück. | Sign-in page images | Everyone sees them, signed in or not | Removing all brings back the shipped ones. |
| C1 Public URL | Öffentliche Adresse | Für Einladungen, Mails und neue Passwörter | Pflicht. Ohne sie zeigen Links auf localhost. Auch Kalender-Abos und der Rücksprung von Strava nutzen sie. | Public address | For invitations, e-mails and password resets | Required. Without it, links point to localhost. Calendar feeds and the Strava return use it too. |
| C1 Public URL for device pairing | Adresse für Telefone | Steht im Kopplungs-QR | Leer: die Adresse, unter der du TravStats gerade offen hast. Passkeys nehmen sie, wenn keine erlaubten Adressen eingetragen sind. | Address for phones | Goes into the pairing QR | Empty: the address you have TravStats open at right now. Passkeys use it when no allowed addresses are set. |
| C1 Internal URL (LAN) | Adresse im eigenen Netz | Nur für den Rücksprung von Strava | Telefone bekommen sie nicht; das Koppeln nimmt die Adresse für Telefone. | Local network address | Only for the Strava return | Phones don't get it; pairing uses the address for phones. |
| C1 Passkey domain (rpId) | Passkey-Domain | Nur die Domain, keine IP | Ändern macht jeden angelegten Passkey wertlos. | Passkey domain | Domain only, no IP | Changing it voids every passkey ever created. |
| C1 Allowed origins | Erlaubte Adressen | Eine pro Zeile, mit https und Port | Die erste zählt. Mehrere nur mit derselben Domain. Leer: die Adresse für Telefone. | Allowed addresses | One per line, with https and port | The first one counts. Several only on the same domain. Empty: the address for phones. |
| C1 Show beta features | Beta-Funktionen zeigen | Für alle Konten | Öffnet: Telefone koppeln, Touren, Planen, Schiffswege, Flugwege hochladen, Rangliste, verschlüsselt übergeben, Kalender-Abo, Teilen mit anderen Servern, TravTrack. | Show beta features | For every account | Opens: pairing phones, tours, planning, ship tracks, flight path upload, leaderboard, encrypted handover, calendar feed, sharing with other servers, TravTrack. |
| C1 TravTrack offered | TravTrack anbieten | Standort auf diesem Server speichern |  | Offer TravTrack | Store location on this server |  |
| C1 TravPlan offered | Planen anbieten |  | Aus behält alle Pläne, blendet sie nur aus. | Offer planning |  | Off keeps all plans, only hides them. |
| C1 TravPlan daily limits | Planen: Anfragen pro Tag | KI · Wetter, je Konto |  | Planning: requests per day | AI · weather, per account |  |
| C1 Country counting default | Ein Land zählt ab | Konten können abweichen |  | A country counts from | Accounts may differ |  |
| C1 Import mode | Großer Import | Hebt Upload-Grenzen für 24 h auf | Schaltet sich von selbst ab. | Big import | Lifts upload limits for 24 h | Turns itself off. |
| C4 Who reads first | Wer zuerst liest |  | Vorlagen lesen Flugmails in unter einer Sekunde. | Who reads first |  | Templates read flight mails in under a second. |
| C4 Use the AI model | KI verwenden | Lesen, Spalten zuordnen, Zusammenfassungen | Aus: keine KI, auch wenn Ollama eingerichtet ist. | Use AI | Reading, column mapping, summaries | Off: no AI, even if Ollama is set up. |
| C4 Cloud provider priority | Reihenfolge der Cloud-KI | Ollama kommt immer zuerst | Versucht wird nur, wer Schlüssel und Freigabe hat. | Cloud AI order | Ollama always comes first | Only providers with key and approval are tried. |
| C4 Built-in readers | Immer dabei |  |  | Always included |  |  |
| C4 Action: Test Ollama connection | Ollama prüfen |  |  | Check Ollama |  |  |
| C1 Maximum users | Höchstens Konten |  |  | Maximum accounts |  |  |
| C1 Allow public registration | Anmelden ohne Einladung |  | Dann kann sich jeder ein Konto anlegen, bis die Höchstzahl erreicht ist. | Sign up without invitation |  | Anyone can then create an account until the maximum is reached. |
| C2 User list + actions (deactivate, reset password, reset 2FA, delete) | Konten |  | Je Konto unter ⋯: sperren, Passwort neu setzen, zweiten Faktor zurücksetzen, löschen. | Accounts |  | Per account under ⋯: lock, set new password, reset second step, delete. |
| C2 Invitation list + actions (create, by e-mail, copy, resend, revoke) | Einladungen | Ein Link gilt einmal und 7 Tage | Per Mail geht nur, wenn der Server Mails verschickt. | Invitations | A link works once, for 7 days | By e-mail only works if the server sends mail. |
| C6 Automatic backup | Automatisch sichern | Um 02:00 |  | Back up automatically | At 02:00 |  |
| C6 Interval | Wie oft |  |  | How often |  |  |
| C6 Retention | Aufheben | 1–365 Tage | Die letzte vollständige Sicherung bleibt immer. | Keep for | 1–365 days | The last full backup always stays. |
| C6 Time zone of backup hour | Zeitzone für 02:00 |  |  | Time zone for 02:00 |  |  |
| C6 Also delete expired from WebDAV | Auch auf WebDAV aufräumen |  |  | Also clean up on WebDAV |  |  |
| C6 Action: Create backup now | Jetzt sichern |  |  | Back up now |  |  |
| C6 Actions: Download / Upload / Delete / Restore | Sicherungen |  | Je Sicherung unter ⋯: herunterladen, hochladen, wiederherstellen, löschen. | Backups |  | Per backup under ⋯: download, upload, restore, delete. |
| C6 Action: Load backups from WebDAV | Sicherungen von WebDAV holen | Nach einem Umzug |  | Fetch backups from WebDAV | After moving servers |  |
| C7 Debug mode | Ausführlich protokollieren | Macht den Server langsamer |  | Verbose logging | Slows the server down |  |
| C7 Log level | Stufe |  |  | Level |  |  |
| C7 Log retention | Aufheben | 1–90 Tage |  | Keep for | 1–90 days |  |
| C7 Log HTTP requests | Anfragen mitschreiben |  |  | Log requests |  |  |
| C7 Log DB queries | Datenbank mitschreiben |  |  | Log database |  |  |
| C7 Log parser operations | Lesen mitschreiben |  |  | Log reading |  |  |
| C7 Log file list + viewer | Protokolldateien | Ansehen, laden, löschen |  | Log files | View, download, delete |  |
| C7 Action: cleanup old logs | Alte Protokolle löschen |  |  | Delete old logs |  |  |
| C7 System: version and build | Version |  |  | Version |  |  |
| C7 Action: Download full backup (JSON) | Alle Daten aller Konten | JSON |  | All data of all accounts | JSON |  |
| C7/C3 Action: Re-seed catalogues | Kataloge neu einlesen | Flughäfen, Airlines, Flugzeugtypen | Höchstens dreimal pro Stunde. Selbst angelegte Einträge bleiben unberührt. | Re-read catalogues | Airports, airlines, aircraft types | At most three times an hour. Entries you added stay untouched. |
| C7 Action: Delete demo user | Demo-Konto löschen |  |  | Delete demo account |  |  |
| C7 Time model: migration report | Umstellung der Zeiten |  |  | Time conversion |  |  |
| C7 Action: Re-resolve time zones | Zeitzonen neu bestimmen | Erst Probelauf, dann übernehmen |  | Determine time zones again | Dry run first, then apply |  |
| C7 Master data: airlines | Airlines |  |  | Airlines |  |  |
| C7 Master data: aircraft | Flugzeugtypen |  |  | Aircraft types |  |  |
| C7 Master data: airports | Flughäfen |  |  | Airports |  |  |
| C7 Master data: ships | Schiffe |  |  | Ships |  |  |
| C7 Master data: ports | Häfen |  |  | Ports |  |  |
| C7 Master data: hotel chains (edit, merge, delete) | Hotelketten |  |  | Hotel chains |  |  |
| C1 About | Version |  |  | Version |  |  |
| C1 About (build) | Build |  |  | Build |  |  |
| A13 Turn off a service for my account (Vorlage „mine“, in jeder Dienst-Karte mit dieser Fähigkeit) | Für mich nutzen |  | Hat der Admin den Dienst abgeschaltet, bleibt er aus. | Use for me |  | If your admin switched the service off, it stays off. |
| A13 Own API key per provider (Vorlage „ownKey“, in jeder Dienst-Karte mit dieser Fähigkeit) | Eigener Schlüssel | Statt des Server-Schlüssels | Dein Schlüssel geht vor dem des Servers. Er wird verschlüsselt gespeichert und nie wieder angezeigt. | Own key | Instead of the server's key | Your key wins over the server's. It's stored encrypted and never shown again. |
| C3 Service on/off (Vorlage „on“, in jeder Dienst-Karte mit dieser Fähigkeit) | Auf dem Server an | Aus: keine Anfrage, auch kein Test | Gilt für alle Konten, auch mit eigenem Schlüssel. | On for this server | Off: no requests, not even a test | Applies to every account, even with its own key. |
| C3 Credential fields (Vorlage „instKey“, in jeder Dienst-Karte mit dieser Fähigkeit) | Schlüssel des Servers | Für alle Konten ohne eigenen | Leer lassen behält den gespeicherten Schlüssel. | Server key | For every account without its own | Leave empty to keep the stored key. |
| C3 Allow account keys (Vorlage „allowKeys“, in jeder Dienst-Karte mit dieser Fähigkeit) | Eigene Schlüssel erlauben |  |  | Allow own keys |  |  |
| C3 What accounts may connect (Vorlage „allowConn“, in jeder Dienst-Karte mit dieser Fähigkeit) | Konten dürfen sich verbinden |  | Jedes Konto trägt seine Zugangsdaten selbst ein. | Accounts may connect |  | Each account enters its own credentials. |
| C3 Test / A13 Test (Vorlage „test“, in jeder Dienst-Karte mit dieser Fähigkeit) | Verbindung prüfen |  | Prüft die gespeicherte Einstellung. Das Ergebnis bleibt mit Uhrzeit stehen. | Check connection |  | Checks the saved setup. The result stays with its time. |
| C3 Quota / budget display (Vorlage „quota“, in jeder Dienst-Karte mit dieser Fähigkeit) | Kontingent |  | Wie der Anbieter es meldet. TravStats hört vor der Grenze auf. | Quota |  | As reported by the provider. TravStats stops before the limit. |
| C3 Always-on services (Vorlage „always“, in jeder Dienst-Karte mit dieser Fähigkeit) | Immer an | Ohne diesen Dienst arbeitet TravStats nicht |  | Always on | TravStats can't work without it |  |
| C3 Consent to enable a cloud AI provider (Vorlage „aiAllow“, in jeder Dienst-Karte mit dieser Fähigkeit) | Für Konten freigeben | Danach stimmt jedes Konto selbst zu | Was hingeht: der Text einer Mail oder PDF, höchstens 12.000 Zeichen, nur wenn die Vorlagen nichts finden. | Offer to accounts | Each account then agrees on its own | What goes there: the text of an e-mail or PDF, at most 12,000 characters, only when templates find nothing. |
| A13 AI approval per provider (Vorlage „aiConsent“, in jeder Dienst-Karte mit dieser Fähigkeit) | Meine Texte dürfen hin | Nur wenn die Vorlagen nichts finden | Höchstens 12.000 Zeichen pro Mail oder PDF. Ändert sich die Adresse des Anbieters, frage ich neu. | My texts may go there | Only when templates find nothing | At most 12,000 characters per e-mail or PDF. If the provider's address changes, I'll ask again. |
| C3 Credential fields (model) (Vorlage „model“, in jeder Dienst-Karte mit dieser Fähigkeit) | Modell |  |  | Model |  |  |

### 5.2 Statuszeilen statt Regler (Nicht-Admin)

| Einstellung | Deutsch | Englisch |
|---|---|---|
| Auf dem Server an | Vom Admin abgeschaltet | Switched off by your admin |
| Eigene Schlüssel erlauben | Eigene Schlüssel sind hier nicht erlaubt | Own keys aren't allowed here |
| Konten dürfen sich verbinden | Der Admin erlaubt keine eigene Verbindung | Your admin doesn't allow own connections |
| Für Konten freigeben | Vom Admin nicht freigegeben | Not enabled by your admin |
| Öffentliche Links erlauben | Auf diesem Server aus | Off on this server |
| Mitteilungen senden | Auf diesem Server aus · App-Erinnerungen gehen nicht | Off on this server · app reminders won't arrive |

### 5.3 Seiten und Abschnitte

| Adresse | Deutsch | Englisch |
|---|---|---|
| `/settings/account` | Profil & Anmeldung | Profile & sign-in |
| `/settings/display` | Sprache & Einheiten | Language & units |
| `/settings/domains` | Reisearten | Travel types |
| `/settings/flight` | Flüge | Flights |
| `/settings/cruise` | Kreuzfahrten | Cruises |
| `/settings/trips` | Reisen & Eingang | Trips & inbox |
| `/settings/sharing` | Teilen | Sharing |
| `/settings/notifications` | Erinnerungen | Reminders |
| `/settings/location` | Standort | Location |
| `/settings/loyalty` | Treueprogramme | Loyalty |
| `/settings/data` | Daten | Data |
| `/settings/services` | Dienste | Services |
| `/settings/server` | Server | Server |
| `/settings/users` | Nutzer | Users |
| `/settings/backups` | Sicherungen | Backups |
| `/settings/maintenance` | Wartung | Maintenance |
| `/settings/masterdata` | Stammdaten | Reference data |
| `/settings/about` | Über TravStats | About TravStats |
| `/settings/account#profile` | Profil | Profile |
| `/settings/account#home` | Zuhause | Home |
| `/settings/account#security` | Anmeldung | Sign-in |
| `/settings/account#devices` | Companion-App | Companion app |
| `/settings/account#apitokens` | API-Schlüssel | API keys |
| `/settings/account#deletion` | Konto löschen | Delete account |
| `/settings/display#language` | Sprache & Zeit | Language & time |
| `/settings/display#units` | Einheiten | Units |
| `/settings/display#views` | Karte, Start & Listen | Map, home & lists |
| `/settings/domains#domains` | Was du festhältst | What you log |
| `/settings/domains#planning` | Planen | Planning |
| `/settings/domains#countryCounting` | Länder | Countries |
| `/settings/flight#homeAirport` | Heimatflughäfen | Home airports |
| `/settings/flight#defaults` | Neue Flüge starten mit | New flights start with |
| `/settings/flight#features` | Was festgehalten wird | What gets recorded |
| `/settings/flight#autoupdate` | Live-Updates | Live updates |
| `/settings/flight#enrichment` | Ältere Flüge ergänzen | Fill in older flights |
| `/settings/cruise#cruisePreferences` | Neue Kreuzfahrten starten mit | New cruises start with |
| `/settings/cruise#counting` | Zählen | Counting |
| `/settings/trips#trips` | Reisen | Trips |
| `/settings/trips#suggestions` | Vorschläge im Eingang | Inbox suggestions |
| `/settings/trips#calendarFeed` | Kalender | Calendar |
| `/settings/sharing#companions` | Mitreisende | Companions |
| `/settings/sharing#accounts` | Mit Konten auf diesem Server | With accounts on this server |
| `/settings/sharing#servers` | Mit anderen Servern | With other servers |
| `/settings/sharing#shareLinks` | Öffentliche Links | Public links |
| `/settings/sharing#compare` | Vergleichen & übergeben | Compare & hand over |
| `/settings/notifications#channel` | Wohin | Where |
| `/settings/notifications#domains` | Vor der Abreise | Before you leave |
| `/settings/location#locationProvider` | Quelle | Source |
| `/settings/location#stayScan` | Aufenthalte finden | Find stays |
| `/settings/location#travTrack` | TravTrack | TravTrack |
| `/settings/location#history` | Verlauf | History |
| `/settings/loyalty#loyalty` | Karten | Cards |
| `/settings/data#backup` | Sicherung | Backup |
| `/settings/data#export` | Mitnehmen | Take out |
| `/settings/data#import` | Einlesen | Bring in |
| `/settings/data#railImport` | Beim Import von bahn.de | When importing from bahn.de |
| `/settings/server#general` | Allgemein | General |
| `/settings/server#addresses` | Adressen | Addresses |
| `/settings/server#passkeys` | Passkeys | Passkeys |
| `/settings/server#features` | Was der Server anbietet | What the server offers |
| `/settings/server#parsers` | Buchungen lesen | Reading bookings |
| `/settings/users#access` | Zugang | Access |
| `/settings/users#accounts` | Konten | Accounts |
| `/settings/users#invitations` | Einladungen | Invitations |
| `/settings/backups#automatic` | Automatisch | Automatic |
| `/settings/backups#backups` | Vorhandene Sicherungen | Existing backups |
| `/settings/maintenance#logging` | Protokoll | Log |
| `/settings/maintenance#system` | System | System |
| `/settings/maintenance#timeModel` | Zeitzonen | Time zones |
| `/settings/masterdata#catalogues` | Kataloge | Catalogues |
| `/settings/about#about` | Version | Version |

### 5.4 Dienste (31) und Gruppen

| Gruppe DE | Gruppe EN |
|---|---|
| Alle | All |
| Flugdaten | Flight data |
| Karten & Routen | Maps & routes |
| Fotos & Standort | Photos & location |
| KI | AI |
| Offene Daten | Open data |
| Sync & Mail | Sync & mail |
| Instanz | Instance |

| Katalog-id | Name | Zweck · Grundstand | Name EN | Zweck · Stand EN | Vorlagen |
|---|---|---|---|---|---|
| `airlabs` | AirLabs | Flugpläne und Strecken · Über den Server | AirLabs | Schedules and routes · Via the server | ownKey, mine, on, instKey, allowKeys, test, quota |
| `aviationstack` | Aviationstack | Flugstatus · Über den Server | Aviationstack | Flight status · Via the server | ownKey, mine, on, instKey, allowKeys, test, quota |
| `aerodatabox` | AeroDataBox | Flüge und Maschinen · Nicht eingerichtet | AeroDataBox | Flights and aircraft · Not set up | ownKey, mine, on, instKey, allowKeys, test, quota |
| `aeroapi` | FlightAware AeroAPI | Flugstatus und echte Flugwege · Nicht eingerichtet | FlightAware AeroAPI | Flight status and real tracks · Not set up | on, instKey, test |
| `opensky` | OpenSky | Positionen in der Luft · Über den Server | OpenSky | Positions in the air · Via the server | mine, on, allowKeys, test, quota |
| `adsblol` | ADS-B Lol | Positionen in der Luft, frei · Aus | ADS-B Lol | Positions in the air, free · Off | on, instKey, test, quota |
| `adsbx` | ADS-B Exchange | Positionen in der Luft · Nicht eingerichtet | ADS-B Exchange | Positions in the air · Not set up | on, instKey, test, quota |
| `aisstream` | AISStream | Schiffspositionen · Nicht eingerichtet | AISStream | Ship positions · Not set up | on, instKey |
| `openrouteservice` | OpenRouteService | Routen für Touren · Nicht eingerichtet | OpenRouteService | Routes for tours · Not set up | ownKey, mine, on, instKey, allowKeys, test |
| `graphhopper` | GraphHopper | Routen für Touren · Nicht eingerichtet | GraphHopper | Routes for tours · Not set up | ownKey, mine, on, instKey, allowKeys, test |
| `railTimetables` | Transitous & db-rest | Bahn-Fahrpläne · An | Transitous & db-rest | Rail timetables · On | — |
| `googlePlaces` | Google Places | Orte und Öffnungszeiten · Aus | Google Places | Places and opening hours · Off | on, instKey, test |
| `geocoder` | Photon & Nominatim | Ortssuche · Immer an | Photon & Nominatim | Place search · Always on | always |
| `selfHostedRouting` | OSRM & OpenRailRouting | Eigenes Routing · Aus | OSRM & OpenRailRouting | Own routing · Off | on |
| `immich` | Immich | Fotos · Nicht verbunden | Immich | Photos · Not connected | mine, allowConn, on |
| `dawarich` | Dawarich | Standortverlauf · Nicht verbunden | Dawarich | Location history · Not connected | mine, allowConn, on |
| `strava` | Strava | Aktivitäten · Nicht verbunden | Strava | Activities · Not connected | mine, allowConn, on |
| `ollama` | Ollama | KI auf deinem Server · Bereit | Ollama | AI on your server · Ready | on, test |
| `openai` | OpenAI | KI in der Cloud · Nicht freigegeben | OpenAI | Cloud AI · Not enabled | aiConsent, aiAllow, instKey, model, test |
| `anthropic` | Anthropic | KI in der Cloud · Nicht freigegeben | Anthropic | Cloud AI · Not enabled | aiConsent, aiAllow, instKey, model, test |
| `gemini` | Google Gemini | KI in der Cloud · Nicht freigegeben | Google Gemini | Cloud AI · Not enabled | aiConsent, aiAllow, instKey, model, test |
| `customLlm` | OpenAI-kompatibel | Eigener KI-Anbieter · Nicht freigegeben | OpenAI-compatible | Own AI provider · Not enabled | aiConsent, aiAllow, instKey, model, test |
| `openData` | OpenStreetMap · Overpass | Märkte und Orte aus offenen Daten · Aus | OpenStreetMap · Overpass | Markets and places from open data · Off | on |
| `logos` | Logostream | Logos von Airlines und Betreibern · An | Logostream | Airline and operator logos · On | on, instKey, test |
| `fx` | EZB-Kurse | Wechselkurse · Immer an | ECB rates | Exchange rates · Always on | always |
| `webdav` | WebDAV | Backup-Ziel · Nicht verbunden | WebDAV | Backup target · Not connected | mine, allowConn, on |
| `smtp` | Mail (SMTP) | Mail-Versand · An | Mail (SMTP) | Sending mail · On | — |
| `push` | Push | Mitteilungen an die Companion-App · Aus | Push | Notifications to the Companion app · Off | — |
| `federation` | Andere Server | Föderation zwischen TravStats-Servern · Aus | Other servers | Federation between TravStats servers · Off | — |
| `usageStats` | Nutzungsstatistik | Täglicher Bericht ohne Namen · Nicht gefragt | Usage statistics | Daily report without names · Not asked | — |
| `updatesTemplates` | GitHub | Neue Versionen und Vorlagen · An | GitHub | New versions and templates · On | — |

Status-Pillen: Über den Server / Via the server · Nicht eingerichtet / Not set up · Aus / Off · An / On · Immer an / Always on · Nicht verbunden / Not connected · Verbunden / Connected · Bereit / Ready · Nicht freigegeben / Not enabled · Nicht gefragt / Not asked · Prüft gleich / Checking shortly (gestrichelt) · Schlüssel abgelehnt / Key rejected · Vom Admin abgeschaltet / Switched off by your admin.

### 5.5 Auswahlwerte

| Einstellung | Deutsch | Englisch |
|---|---|---|
| Sprache | Deutsch · English | Deutsch · English |
| Datum | 31.12.2026 · 12/31/2026 · 2026-12-31 | 31.12.2026 · 12/31/2026 · 2026-12-31 |
| Uhrzeit | 24 h · 12 h | 24 h · 12 h |
| Entfernung | km · mi · sm | km · mi · nmi |
| Gepäck | kg · lb | kg · lb |
| Ein Land zählt ab | Wie der Server · übernachtet · besucht · durchreist · umgestiegen | Server default · stayed overnight · visited · passed through · changed planes |
| Status | geplant · geflogen | planned · flown |
| Klasse | keine · Economy · Premium Economy · Business · First | keine · Economy · Premium Economy · Business · First |
| Anlass | keiner · Geschäftlich · Privat · Urlaub | none · Business · Private · Holiday |
| Kabine | keine · Innen · Meerblick · Balkon · Suite | none · Inside · Ocean view · Balcony · Suite |
| Standort kommt von | Keine · TravTrack · Dawarich | None · TravTrack · Dawarich |
| Wie oft | täglich · wöchentlich | daily · weekly |
| U-Bahn und Tram | weglassen · als Bahnfahrt | skip · as rail journey |
| Busabschnitte | weglassen · als Busfahrt | skip · as bus ride |
| Fotos an Reisen | verknüpfen · kopieren | link · copy |
| Nutzungsstatistik senden | nein · ja | no · yes |
| Großer Import | aus · 24 h für alle · 24 h für ein Konto | off · 24 h for all · 24 h for one account |
| Wer zuerst liest | Vorlagen zuerst · KI zuerst | Templates first · AI first |
| Wie oft | täglich · sonntags · am 1. | daily · Sundays · on the 1st |
| Erinnerungen › Kanal | App · Mail · beide | App · Mail · both |
| Erinnerungen › Vorlauf | 24 h · 2 h · + eigene | 24 h · 2 h · + own |

### 5.6 Abhängigkeiten

| Schlüssel | Deutsch · Sprung | Englisch · Sprung |
|---|---|---|
| noImmich | Immich ist nicht verbunden. · Verbinden › | Immich isn't connected. · Connect › |
| noFlightData | Braucht einen Flugdaten-Dienst. · Zu Dienste › | Needs a flight data service. · Go to services › |
| autoOff | Wirkt erst mit Live-Updates. | Only works with live updates. |
| stayOff | Wirkt erst mit Aufenthaltsvorschlägen. · Einschalten › | Only works with stay suggestions. · Turn on › |
| placesOff | Orte ist aus. · Einschalten › | Places is off. · Turn on › |
| cruiseOff | Kreuzfahrten ist aus. · Einschalten › | Cruises is off. · Turn on › |
| toursOff | Touren ist aus. · Einschalten › | Tours is off. · Turn on › |
| noLocSource | Wirkt erst mit einer Standortquelle. · Quelle wählen › | Needs a location source. · Choose source › |
| aiNotAllowed | Der Admin hat keine KI freigegeben. | Your admin hasn't enabled AI. |
| noFederation | Der Admin hat andere Server nicht freigegeben. | Your admin hasn't allowed other servers. |
| noPublicUrl | Dem Server fehlt eine öffentliche Adresse. · Adresse setzen › | The server has no public address. · Set address › |
| no2fa | Erst mit zweitem Faktor. | Needs two-step sign-in first. |
| noSmtp | Der Server verschickt keine Mails. · Mail einrichten › | The server doesn't send mail. · Set up mail › |
| noWebdav | Noch kein WebDAV-Speicher verbunden. · Verbinden › | No WebDAV storage connected yet. · Connect › |
| noTravTrack | Der Server bietet TravTrack nicht an. | This server doesn't offer TravTrack. |
| noTravPlan | Der Server bietet Planen nicht an. · Anbieten › | This server doesn't offer planning. · Offer it › |
| webdavOff | Wirkt erst mit WebDAV-Kopie. | Only works with the WebDAV copy. |
| noMailAddr | Mail geht erst mit einer Adresse oben. | Mail needs an address above. |
| envPinned | Vom Server-Start festgelegt (LOG_LEVEL). Wirksam: info. | Pinned at server start (LOG_LEVEL). In effect: info. |
| noOllama | Braucht Ollama. | Needs Ollama. |
| noOwnDawarich | Braucht deine eigene Dawarich-Verbindung. Die des Servers reicht dafür nicht. · Verbinden › | Needs your own Dawarich connection. The server's isn't enough. · Connect › |
| dawSrcMissing | Dawarich ist für dich noch nicht verbunden. Bis dahin liest TravStats keine Positionen. · Verbinden › | Dawarich isn't connected for you yet. Until then TravStats reads no positions. · Connect › |
| noPush | Der Server sendet gerade keine Mitteilungen an die App. | The server isn't sending notifications to the app right now. |
| publicUrlMissing | Fehlt noch. Bis dahin zeigen Einladungen, Mails und Kalender auf localhost. | Still missing. Until then invitations, e-mails and calendars point to localhost. |

### 5.7 Rahmen, Stufe, Geltung, Suche

| Deutsch | Englisch |
|---|---|
| Dein Konto | Your account |
| Server · nur Admin | Server · admin only |
| Über TravStats | About TravStats |
| Alle Einstellungen | All settings |
| Einstellung suchen | Search settings |
| Standard / Experte | Standard / Expert |
| Experte zeigt {n} weitere Einstellungen | Expert shows {n} more settings |
| Alles sichtbar · Feinarbeit ist markiert | Everything visible · fine-tuning is marked |
| EXPERTE | EXPERT |
| Gilt für dein Konto | Applies to your account |
| Gilt für dein Konto · Zeilen mit „Alle Konten“ gelten für den Server | Applies to your account · rows marked “All accounts” apply to the server |
| Gilt für alle Konten · nur Admin | Applies to all accounts · admin only |
| Alle Konten | All accounts |
| Nur dieses Gerät | This device only |
| Im Demo-Konto gesperrt | Locked in the demo account |
| Hilfe | Help |
| Mehr (⋯) | More |
| Farbe wählen | Choose colour |
| Einstellungen › | Settings › |
| {n} Treffer | {n} results |
| 8 von {n} Treffern · weiter tippen | 8 of {n} results · keep typing |
| Nichts gefunden für „{q}“. | Nothing found for “{q}”. |
| Experten-Treffer öffnen sich, ohne deine Stufe zu ändern. | Expert results open without changing your level. |
| Experten-Einstellung · nur für diesen Besuch sichtbar. Deine Stufe bleibt Standard. · Immer zeigen | Expert setting · visible for this visit only. Your level stays Standard. · Always show |
| Das gilt für alle Konten. Ändern kann es nur ein Admin. | This applies to all accounts. Only an admin can change it. |
| Zuerst · Ausblenden | First · Hide |
| Sprache & Einheiten · Wohnort · Woher dein Standort kommt | Language & units · Home town · Where your location comes from |
| nicht gesetzt · keine Quelle | not set · no source |
| {Reiseart} ist aus. Die Einstellungen bleiben erhalten. · Einschalten | {Type} is off. The settings are kept. · Turn on |
| Schließen | Close |
| Bild wählen | Choose image |
| Noch keine | None yet |

### 5.8 Speichern und Prüfen

| Zustand | Deutsch | Englisch |
|---|---|---|
| Einzelwert wartet | Gleich gespeichert | Saving in a moment |
| Einzelwert gespeichert | Gespeichert | Saved |
| Einzelwert gescheitert | Ich konnte das nicht speichern. {Grund} Deine Auswahl bleibt stehen. | I couldn't save this. {Reason} Your choice stays. |
| Grund: offline | Der Server antwortet gerade nicht. | The server isn't answering right now. |
| Grund: abgewiesen | Der Server hat den Wert nicht angenommen. | The server didn't accept the value. |
| Grund: Zeitzone | Diese Zeitzone kenne ich nicht. | I don't know this time zone. |
| Grund: Demo | Im Demo-Konto speichere ich das nicht. | I don't save this in the demo account. |
| Knöpfe | Erneut versuchen · Verwerfen | Try again · Discard |
| Verlassen (Seite schließt, Wert unterwegs) | — kein Text: der Schreibvorgang geht trotzdem raus | — no text: the write still goes out |
| Gruppe geändert | Nicht gespeichert | Not saved |
| Gruppe Knöpfe | Speichern · Speichern & testen · Verwerfen | Save · Save & test · Discard |
| Verlassen mit Gruppe | siehe Dialog `leave` · Knöpfe Bleiben / Verwerfen | see dialog `leave` · Stay / Discard |
| Test wartet | Ergebnis kommt gleich | Result coming up |
| Test gut | Verbunden · gerade geprüft | Connected · just checked |
| Test später | Verbunden · geprüft {Zeit} | Connected · checked {time} |
| Gespeichert, nicht geprüft | Gespeichert, aber noch nicht geprüft. | Saved but not checked yet. |
| Schlüssel falsch | Ich komme nicht hinein: Der Schlüssel wurde abgelehnt. | I can't get in: the key was rejected. |
| Nicht erreichbar | Ich erreiche den Dienst nicht. | I can't reach the service. |
| Falsches Gegenüber | Unter dieser Adresse antwortet etwas anderes als {Dienst}. | Something other than {service} answers at this address. |
| Nicht gefunden | Unter dieser Adresse finde ich nichts. | I find nothing at this address. |
| Zu viele Anfragen | Der Anbieter bremst gerade. Ich versuche es später. | The provider is throttling. I'll try later. |
| Kontingent leer | Das Kontingent ist für heute aufgebraucht. | Today's quota is used up. |
| Budget leer | Das Monatsbudget ist erreicht. Ich frage erst nächsten Monat wieder. | The monthly budget is reached. I'll ask again next month. |
| Zeitüberschreitung | Nach 10 Sekunden kam keine Antwort. | No answer after 10 seconds. |
| Abgeschaltet | Vom Admin abgeschaltet. Ich frage nicht an, auch nicht zum Test. | Switched off by your admin. I won't ask, not even for a test. |
| Nicht eingerichtet | Nicht eingerichtet | Not set up |
| KI-Zustimmung verfallen | Die Adresse des Anbieters hat sich geändert. Ich frage dich neu. | The provider's address changed. I'll ask you again. |
| Dawarich nur Server | Ich lese deinen Standort nur über deine eigene Dawarich-Verbindung. | I only read your location through your own Dawarich connection. |
| Push-Status | 1 Telefon bereit · Kein Telefon erlaubt Mitteilungen · Ein Telefon hat die Mitteilungen abgelehnt | 1 phone ready · No phone allows notifications · A phone declined notifications |

### 5.9 Formmeldungen (Zeile unter dem Feld, `bad`-Rand, Ich-Form)

| Feld | Deutsch | Englisch |
|---|---|---|
| Profilbild Typ | Ich nehme nur PNG oder JPG. | I only take PNG or JPG. |
| Profilbild Größe | Ich nehme Bilder bis 5 MB; dieses ist größer. | I take images up to 5 MB; this one is larger. |
| Profilbild Upload | Ich konnte das Bild nicht hochladen. | I couldn't upload the image. |
| E-Mail | Ich erkenne darin keine Mail-Adresse. | I don't recognise an e-mail address in this. |
| Passwort alt | Ich kenne ein anderes bisheriges Passwort. | I know a different current password. |
| Passwort neu | Ich brauche mindestens 8 Zeichen. · Ich sehe zwei verschiedene neue Passwörter. | I need at least 8 characters. · I see two different new passwords. |
| 2FA-Code | Ich erwarte einen anderen Code. Nimm den aktuellen aus der App. | I expect a different code. Use the current one from the app. |
| 2FA starten | Ich konnte die Einrichtung nicht starten. | I couldn't start the setup. |
| Passkey | Ich lege Passkeys nur über https an. · Ich brauche dafür erst eine Passkey-Domain vom Admin. · Ich konnte den Passkey nicht anlegen. · Ich konnte den Passkey nicht entfernen. | I only create passkeys over https. · I need a passkey domain from your admin first. · I couldn't create the passkey. · I couldn't remove the passkey. |
| Kopplungscode | Der Code verfällt in {mm:ss}. · Dieser Code ist abgelaufen; ich mache dir einen neuen. · Ich brauche erst eine öffentliche Adresse des Servers. | The code expires in {mm:ss}. · This code has expired; I'll make you a new one. · I need a public server address first. |
| API-Schlüssel | Ich brauche einen Namen für den Schlüssel. · Ich konnte den Schlüssel nicht anlegen. | I need a name for the key. · I couldn't create the key. |
| Eigene Erinnerungszeit | Ich nehme ganze Stunden von 1 bis 168. · Diese Zeit habe ich schon. | I take whole hours from 1 to 168. · I already have that time. |
| Erinnerungs-Mail | Ich erkenne darin keine Mail-Adresse. | I don't recognise an e-mail address in this. |
| Schutzzone | Ich kann diese Koordinaten nicht lesen. · Ich nehme Radien von 50 bis 5000 m. | I can't read these coordinates. · I take radii from 50 to 5000 m. |
| Heimatflughäfen | Ich nehme höchstens drei. | I take three at most. |
| Ortssuche | Ich erreiche die Ortssuche gerade nicht. Das heißt nicht, dass es den Ort nicht gibt. | I can't reach place search right now. That doesn't mean the place doesn't exist. |
| Freigabe anfragen | Ich finde hier kein Konto mit diesem Namen. | I find no account with this name here. |
| Einladungscode | Ich kenne diesen Code nicht mehr. · Ich erreiche den anderen Server nicht. | I no longer know this code. · I can't reach the other server. |
| Mitreisende umbenennen | Diesen Namen habe ich schon. Zusammenführen? | I already have this name. Merge? |
| Adresse | Ich brauche https:// am Anfang der Adresse. | I need https:// at the start of the address. |
| Passkey-Domain | Ich brauche eine Domain, keine IP-Adresse. | I need a domain, not an IP address. |
| Tageslimit | Ich nehme höchstens {max}. | I take at most {max}. |
| Zahl allgemein | Ich nehme Werte von {min} bis {max}. | I take values from {min} to {max}. |
| Excel-Datei | Diese Blätter erkenne ich nicht: {Liste}. Sie bleiben außen vor. · In Zeile {n} verstehe ich „{Wert}“ nicht; ich lasse das Feld leer. | I don't recognise these sheets: {list}. They're left out. · In row {n} I don't understand “{value}”; I leave the field empty. |
| GPX/TCX/FIT | Ich kann diese Datei nicht lesen. · Ich nehme ZIPs bis 500 Dateien und 200 MB, eine Aufzeichnung bis 15 MB. | I can't read this file. · I take ZIPs up to 500 files and 200 MB, one recording up to 15 MB. |
| Anmeldebilder | Diese Dateien sind keine Bilder; ich habe sie weggelassen: {Liste}. | These files aren't images; I left them out: {list}. |
| Tippwort | (kein Fehlertext: der Knopf bleibt aus, bis das Wort stimmt) | (no error text: the button stays off until the word matches) |

### 5.10 Hintergrundaufgaben

| Zustand | Deutsch | Englisch |
|---|---|---|
| wartet | Startet gleich | Starting shortly |
| läuft | {Was} · {n} von {m} · fertig in etwa {t} · du kannst die Seite verlassen | {What} · {n} of {m} · done in about {t} · you can leave this page |
| läuft schon | Läuft schon seit {Zeit}. | Already running since {time}. |
| angehalten | Angehalten bei Tag {n} von {m} · Fortsetzen | Paused at day {n} of {m} · Resume |
| fertig | fertig · {Ergebnis} | done · {result} |
| gescheitert | Ich konnte nicht weitermachen: {Grund} · Erneut versuchen | I couldn't continue: {reason} · Try again |
| Ausgang unbekannt | Ich weiß nicht, ob es fertig wurde: Der Server hat zwischendurch neu gestartet. · Nachsehen | I don't know whether it finished: the server restarted meanwhile. · Check |
| Aufenthalte suchen | Suche Aufenthalte der letzten {n} Tage · {k} Funde bisher → {k} Aufenthalte gefunden · Liegen als Vorschlag im Eingang | Searching stays of the last {n} days · {k} found so far → {k} stays found · Waiting in the inbox |
| Aufenthalte: nichts | Keine neuen Aufenthalte in diesen {n} Tagen. | No new stays in these {n} days. |
| Aufenthalte: alte Daten | Die neuesten Punkte sind über 24 Stunden alt. Ich suche mit dem, was da ist. | The newest points are over 24 hours old. I'll search with what's there. |
| Aufenthalte: Märkte | Ich habe die Marktdaten nur teilweise bekommen. | I only got part of the market data. |
| Excel-Import | Lese {Datei} · {n} von {m} → {n} übernommen · {k} entfernt · Sicherung von {Zeit} bleibt 30 Tage | Reading {file} · {n} of {m} → {n} taken over · {k} removed · backup from {time} kept 30 days |
| Excel-Import: Sicherung läuft | Gerade läuft eine Sicherung. Ich fange danach an. | A backup is running. I'll start after it. |
| Excel-Import: Sicherung gescheitert | Ich konnte vorher keine Sicherung anlegen und habe deshalb nichts importiert. | I couldn't take a backup first, so I imported nothing. |
| Export | Bereite {Was} vor → Fertig · Herunterladen | Preparing {what} → Ready · Download |
| Export zu groß | Die Datei wäre zu groß. Ich teile sie: Teil {n} von {m}. | The file would be too large. I'll split it: part {n} of {m}. |
| Dawarich-Verlauf | Übernehme Tag {n} von {m} · Anhalten | Copying day {n} of {m} · Pause |
| Dawarich-Verlauf: Liste | Dawarich hat mir die Liste nur teilweise gegeben. Ich mache mit dem Rest weiter, sobald es antwortet. | Dawarich only gave me part of the list. I'll continue once it answers. |
| Sicherung | Sichere · {n} % → Gesichert · {Größe} | Backing up · {n} % → Backed up · {size} |
| Sicherung: Platz | Auf dem Server habe ich keinen Platz mehr. | I'm out of disk space on the server. |
| Sicherung: Rechte | Ich darf in den Sicherungsordner nicht schreiben. | I'm not allowed to write to the backup folder. |
| Sicherung: Werkzeug | Mir fehlt das Sicherungswerkzeug, oder es passt nicht zur Datenbank. | I'm missing the backup tool, or it doesn't match the database. |
| Sicherung: Datenbank | Ich erreiche die Datenbank nicht. | I can't reach the database. |
| WebDAV-Kopie teilweise | Hochgeladen, aber alte Versionen konnte ich nicht löschen. | Uploaded, but I couldn't delete old versions. |
| WebDAV: Platz | Auf dem WebDAV-Speicher ist kein Platz mehr. | The WebDAV storage is full. |
| Wiederherstellen: Version | Diese Sicherung stammt von einer neueren Version. Ich spiele sie nicht ein. | This backup is from a newer version. I won't restore it. |
| Wiederherstellen: Schlüssel | Die Sicherung nutzt einen anderen Schlüssel. Zugangsdaten der Dienste musst du neu eintragen. | The backup uses a different key. You'll need to re-enter service credentials. |
| Wiederherstellen: unvollständig | Die Sicherung ist unvollständig: {was fehlt}. | The backup is incomplete: {what's missing}. |
| Kataloge | Lese Flughäfen ein · {n} % → {n} aktualisiert, {k} eigene unverändert | Reading airports · {n} % → {n} updated, {k} of yours unchanged |
| Kataloge: Grenze | Das geht dreimal pro Stunde. Wieder ab {Zeit}. | Works three times an hour. Again from {time}. |
| Zeitzonen | Probelauf: {n} Änderungen → Übernehmen · {k} übersprungen, weil seit dem Probelauf geändert | Dry run: {n} changes → Apply · {k} skipped because changed since the dry run |
| Modell laden | Lade {Modell} · {n} % · Ich finde dieses Modell nicht. | Downloading {model} · {n} % · I can't find this model. |
| Import zurücknehmen | {n} zurückgenommen · {k} bleiben, weil anderes darauf verweist | {n} undone · {k} stay because something else refers to them |
| Ländertage zählen | Läuft für {n} Konten · Schon gestartet seit {Zeit}. | Running for {n} accounts · Already started at {time}. |

### 5.11 Ergebnisse von Aktionen

| Aktion | Deutsch | Englisch |
|---|---|---|
| Passwort (Ändern) | Passwort geändert | Password changed |
| Ersatzcodes (Neu erzeugen) | 10 neue Codes · nur jetzt sichtbar | 10 new codes · visible only now |
| Farben zurücksetzen (Zurücksetzen) | Farben zurückgesetzt | Colours reset |
| Kalender-Abo (Link erstellen) | Link erstellt · nur jetzt sichtbar · Kopieren | Link created · visible only now · Copy |
| Einladungscode (Code erstellen) | Code erstellt · gilt bis morgen 14:00 | Code created · valid until tomorrow 14:00 |
| Verlauf exportieren (Exportieren) | Fertig · Herunterladen | Ready · Download |
| Jetzt hochladen (Jetzt hochladen) | Hochgeladen · gerade eben | Uploaded · just now |
| Alle meine Daten (Herunterladen) | Fertig · Herunterladen | Ready · Download |
| Excel-Tabelle (Erstellen) | Fertig · Herunterladen | Ready · Download |
| Aufzeichnungen (Herunterladen) | Fertig · Herunterladen | Ready · Download |
| Besuchsfotos verknüpfen (Verknüpfen) | Läuft · 37 Orte · fertig in etwa 1 Minute | Running · 37 places · done in about 1 minute |
| Ländertage jetzt zählen (Starten) | Läuft · fertig in etwa 4 Minuten | Running · done in about 4 minutes |
| Mit Strava verbinden (Verbinden) | Verbunden als Mara O. | Connected as Mara O. |
| Modell auf den Server laden (Laden) | Modell geladen | Model downloaded |
| Logos neu laden (Neu laden) | 84 Logos neu · 1.210 geprüft | 84 new logos · 1,210 checked |
| Verbindung prüfen (Testen) | Testmail an mara@example.org verschickt | Test mail sent to mara@example.org |
| Server-Schlüssel (Erzeugen) | Schlüssel erzeugt · Fingerabdruck zeigen | Key generated · show fingerprint |
| Ollama prüfen (Testen) | Erreichbar · gerade geprüft | Reachable · just checked |
| Jetzt sichern (Jetzt sichern) | Gesichert · 1,2 GB | Backed up · 1.2 GB |
| Sicherungen von WebDAV holen (Laden) | 3 Sicherungen gefunden | 3 backups found |
| Alle Daten aller Konten (Herunterladen) | Fertig · Herunterladen | Ready · Download |
| Zeitzonen neu bestimmen (Probelauf) | Probelauf: 14 Änderungen · Übernehmen | Dry run: 14 changes · Apply |
| Verbindung prüfen (Vorlage test) | Erreichbar · gerade geprüft | Reachable · just checked |
| Meine Texte dürfen hin (Vorlage aiConsent) | Zugestimmt · Zurückziehen | Agreed · Withdraw |
| Telefon koppeln | Code {123 456} · verfällt in 09:58 | Code {123 456} · expires in 09:58 |
| Passkey hinzufügen | Passkey „{Name}“ angelegt | Passkey “{name}” created |
| Neuer API-Schlüssel | Schlüssel erstellt · nur jetzt sichtbar · Kopieren | Key created · visible only now · Copy |
| Schlüssel erstellen (OwnTracks/Overland) | Schlüssel erstellt · nur jetzt sichtbar · Kopieren | Key created · visible only now · Copy |
| Anfragen (Reisen teilen) | Anfrage an {Konto} geschickt · wartet | Request sent to {account} · waiting |
| Einladen | Link erstellt · gilt 7 Tage · Kopieren · Per Mail schicken | Link created · valid 7 days · Copy · Send by e-mail |
| Kopieren gescheitert | Ich konnte nicht kopieren. Markier den Text und kopier ihn selbst. | I couldn't copy. Select the text and copy it yourself. |
| Code einlösen | Verbunden mit {Name} auf {Server} | Connected with {name} on {server} |
| Karte hinzufügen | Karte gespeichert | Card saved |
| Zustimmung zurückziehen (KI) | Zurückgezogen · ich sende nichts mehr | Withdrawn · I send nothing more |
| Löschung abbrechen | Löschung abgebrochen · dein Konto bleibt | Deletion cancelled · your account stays |
| Generisch (nur wenn nichts Genaueres passt) | Erledigt | Done |

### 5.12 Bestätigungen (29 Dialoge, in `settings-data.json → dialogs`)

Vorlage: Titel · BETRIFFT · WIE VIEL · DANACH · Gefahr-Knopf (· Tippwort). Zweiter Knopf immer „Abbrechen“ / „Cancel“, im Dialog `leave` „Bleiben“ / „Stay“. Feldnamen: Betrifft / Affects · Wie viel / How much · Danach / Afterwards · Zum Bestätigen {WORT} tippen / Type {WORD} to confirm.

| id | Titel | Betrifft | Wie viel | Danach | Knopf |
|---|---|---|---|---|---|
| `replace` | Inhalte ersetzen? | Die Blätter Flüge, Unterkünfte und Orte in deinem Konto | 312 Einträge fehlen in der Datei und werden gelöscht. 540 kommen aus reise-export.xlsx. | Diese Blätter enthalten nur noch, was in der Datei steht. Vorher lege ich eine Sicherung des ganzen Servers an. | 312 Einträge ersetzen · Tippwort ERSETZEN |
| | Replace contents? | The sheets Flights, Stays and Places in your account | 312 entries are missing from the file and will be deleted. 540 come from reise-export.xlsx. | These sheets will only hold what the file contains. I take a backup of the whole server first. | Replace 312 entries · type REPLACE |
| `ttdel` | Tage löschen? | Gespeicherte Positionen vom 03. bis 05.10.2026 | 1.204 Punkte an 3 Tagen | Die Tage bleiben leer, auch wenn ein Telefon sie später nachreicht. | 1.204 Punkte löschen |
| | Delete days? | Stored positions from 03 to 05 Oct 2026 | 1,204 points on 3 days | The days stay empty, even if a phone sends them later. | Delete 1,204 points |
| `zoneadd` | Schutzzone anlegen? | Zuhause, 250 m | 86 Punkte liegen schon darin | Sie werden gelöscht. Entfernen der Zone holt sie nicht zurück. | Anlegen und 86 löschen |
| | Add privacy zone? | Home, 250 m | 86 points are already inside | They'll be deleted. Removing the zone won't bring them back. | Add and delete 86 |
| `tokenrevoke` | Schlüssel zurückziehen? | Heimserver-Skript | 1 Schlüssel | Das Werkzeug kommt sofort nicht mehr hinein. | Zurückziehen |
| | Revoke key? | Heimserver-Skript | 1 key | The tool is locked out at once. | Revoke |
| `deviceout` | Telefon abmelden? | iPhone von Mara | 1 Telefon | Es verliert sofort den Zugang und muss neu gekoppelt werden. | Abmelden |
| | Sign out phone? | iPhone von Mara | 1 phone | It loses access at once and must be paired again. | Sign out |
| `codesnew` | Neue Ersatzcodes? | Deine bisherigen Ersatzcodes | 7 unbenutzte Codes | Sie gelten nicht mehr. Die neuen zeige ich dir nur einmal. | Neu erzeugen |
| | New backup codes? | Your current backup codes | 7 unused codes | They stop working. I'll show the new ones only once. | Regenerate |
| `icsnew` | Neuen Kalender-Link erzeugen? | Dein Kalender-Abo | Jeder Kalender, der den alten Link nutzt | Diese Kalender bekommen keine Reisen mehr. | Neu erzeugen |
| | Create new calendar link? | Your calendar feed | Every calendar using the old link | Those calendars stop getting trips. | Regenerate |
| `shareend` | Teilen beenden? | jonas | 14 geteilte Reisen | Sie bleiben als deine Kopie; Änderungen kommen nicht mehr nach. | Beenden |
| | Stop sharing? | jonas | 14 shared trips | They stay as your copy; changes no longer arrive. | Stop |
| `merge` | Ilka in Jonas aufgehen lassen? | Ilka | 3 Einträge | Sie nennen danach Jonas. Das lässt sich nicht zurücknehmen. | Zusammenführen |
| | Merge Ilka into Jonas? | Ilka | 3 entries | They will name Jonas. This can't be undone. | Merge |
| `unused` | Unbenutzte Mitreisende löschen? | Personen ohne Eintrag | 4 Personen | Sie verschwinden aus allen Vorschlägen. | 4 löschen |
| | Delete unused companions? | People without entries | 4 people | They disappear from all suggestions. | Delete 4 |
| `linksoff` | Öffentliche Links ausschalten? | Alle Konten auf diesem Server | 9 Links von 3 Konten | Ich lösche sie sofort. Wieder einschalten bringt sie nicht zurück. | 9 Links löschen |
| | Turn off public links? | Every account on this server | 9 links from 3 accounts | I delete them at once. Turning on again won't bring them back. | Delete 9 links |
| `userdel` | jonas löschen? | Das Konto jonas mit allen Einträgen und Dateien | 96 Flüge, 11 Reisen | Es lässt sich nur aus einer Sicherung zurückholen. | Löschen · Tippwort JONAS |
| | Delete jonas? | The account jonas with all entries and files | 96 flights, 11 trips | It can only be restored from a backup. | Delete · type JONAS |
| `user2fa` | Zweiten Faktor zurücksetzen? | jonas | 1 Konto | Es meldet sich wieder nur mit Passwort an, bis es den Faktor neu einrichtet. | Zurücksetzen |
| | Reset second step? | jonas | 1 account | They sign in with password only until they set it up again. | Reset |
| `userpw` | Passwort neu setzen? | jonas | 1 Konto | Das alte Passwort gilt nicht mehr. Das neue zeige ich dir einmal. | Neu setzen |
| | Set new password? | jonas | 1 account | The old password stops working. I'll show the new one once. | Set new |
| `userlock` | jonas sperren? | jonas | 1 Konto | Es kann sich nicht mehr anmelden. Seine Daten bleiben. | Sperren |
| | Lock jonas? | jonas | 1 account | They can't sign in. Their data stays. | Lock |
| `invrevoke` | Einladung zurückziehen? | ilka@example.org | 1 Einladung | Der Link gilt sofort nicht mehr. | Zurückziehen |
| | Revoke invitation? | ilka@example.org | 1 invitation | The link stops working at once. | Revoke |
| `restore` | Sicherung zurückspielen? | 01.11.2026 02:00, alles | Alle Konten | Was seitdem geändert wurde, ist weg. Ich sichere vorher den jetzigen Stand. | Zurückspielen · Tippwort WIEDERHERSTELLEN |
| | Restore backup? | 01 Nov 2026 02:00, everything | All accounts | Everything changed since is gone. I'll back up the current state first. | Restore · type RESTORE |
| `bakdel` | Sicherung löschen? | 01.11.2026 02:00 | 1,2 GB · auch auf WebDAV | Die Kopie auf WebDAV lösche ich mit, wenn du es unten einschaltest. | Löschen |
| | Delete backup? | 01 Nov 2026 02:00 | 1.2 GB · also on WebDAV | I delete the WebDAV copy too if you switch it on below. | Delete |
| `smtpdel` | Zugangsdaten löschen? | Den Mail-Zugang des Servers | Alle Konten | Der Server verschickt keine Mails mehr: keine Erinnerungen, keine Einladungen, kein neues Passwort. | Löschen |
| | Delete credentials? | The server's mail access | All accounts | The server sends no mail: no reminders, no invitations, no password reset. | Delete |
| `fedkey` | Server-Schlüssel erneuern? | Die Verbindungen zu anderen Servern | 2 vertraute Server | Sie sind getrennt, bis jeder den neuen Schlüssel bestätigt. | Erneuern |
| | Renew server key? | Connections to other servers | 2 trusted servers | They're cut off until each confirms the new key. | Renew |
| `peerremove` | Server nicht mehr vertrauen? | reise.example.net | 4 geteilte Reisen | Es kommt nichts mehr von dort, und nichts geht mehr hin. Geteilte Reisen bleiben als Kopie. | Entfernen |
| | Stop trusting this server? | reise.example.net | 4 shared trips | Nothing arrives from there and nothing goes there. Shared trips stay as copies. | Remove |
| `reseed` | Kataloge neu einlesen? | Flughäfen, Airlines, Flugzeugtypen | Etwa 14.000 Einträge; deine eigenen 12 bleiben | Mitgelieferte Einträge sind auf dem neuen Stand. Das geht dreimal pro Stunde. | Neu einlesen · Tippwort EINLESEN |
| | Re-read catalogues? | Airports, airlines, aircraft types | About 14,000 entries; your own 12 stay | Shipped entries are up to date. Works three times an hour. | Re-read · type REREAD |
| `rpid` | Passkey-Domain ändern? | Alle Passkeys aller Konten | 5 Passkeys | Keiner funktioniert danach mehr; jeder muss neu angelegt werden. | Ändern · Tippwort ÄNDERN |
| | Change passkey domain? | Every passkey of every account | 5 passkeys | None will work; each must be created again. | Change · type CHANGE |
| `logclean` | Alte Protokolle löschen? | Protokolldateien älter als 7 Tage | 4 Dateien · 38 MB | Sie lassen sich nicht mehr ansehen. | Löschen |
| | Delete old logs? | Log files older than 7 days | 4 files · 38 MB | They can no longer be viewed. | Delete |
| `demodel` | Demo-Konto löschen? | Das Konto demo mit allen Einträgen | 30 Flüge, 4 Reisen | Niemand kann sich mehr als Demo anmelden. | Löschen |
| | Delete demo account? | The account demo with all entries | 30 flights, 4 trips | No one can sign in as demo any more. | Delete |
| `pushreset` | Push-Anmeldung zurücksetzen? | Die Anmeldung des Servers beim Push-Dienst | 2 gekoppelte Telefone | Mitteilungen kommen erst wieder, wenn sich jedes Telefon neu meldet. | Zurücksetzen |
| | Reset push registration? | The server's registration with the push service | 2 paired phones | Notifications return only once each phone checks in again. | Reset |
| `impundo` | Import zurücknehmen? | flugdaten.csv vom 21.10.2026 | 48 Flüge | Ich entferne sie. Flüge, auf die schon anderes verweist, bleiben; ich sage dir, welche. | 48 zurücknehmen |
| | Undo import? | flugdaten.csv from 21 Oct 2026 | 48 flights | I remove them. Flights something else refers to stay; I'll tell you which. | Undo 48 |
| `deleteacct` | Konto löschen? | Dein Konto mara mit allen Einträgen, Fotos und Dateien | 412 Flüge, 38 Reisen, 2.140 Fotos | Nach 30 Tagen ist alles weg, auch für den Admin. Bis dahin kannst du dich anmelden und abbrechen. | Konto löschen · Tippwort LÖSCHEN |
| | Delete account? | Your account mara with all entries, photos and files | 412 flights, 38 trips, 2,140 photos | After 30 days everything is gone, for your admin too. Until then you can sign in and cancel. | Delete account · type DELETE |
| `leave` | Änderungen verwerfen? | Adressen auf der Seite Server | 1 geänderte Angabe | Die Angaben stehen wieder wie zuletzt gespeichert. | Verwerfen |
| | Discard changes? | Addresses on the Server page | 1 changed value | The values go back to what was last saved. | Discard |

### 5.13 Leere Zustände

| Wo | Deutsch | Englisch |
|---|---|---|
| jede Liste | Noch keine | None yet |
| Passkeys | Noch kein Passkey. · Hinzufügen | No passkey yet. · Add |
| Telefone | Noch kein Telefon gekoppelt. · Telefon koppeln | No phone paired yet. · Pair a phone |
| Öffentliche Links | Noch keine Links. Du legst sie an einem Flug, einer Reise oder deinem Jahr an. | No links yet. You create them on a flight, a trip or your year. |
| Treueprogramme | Noch keine Karte. · Karte hinzufügen | No card yet. · Add card |
| Bisherige Importe | Noch nichts importiert. · Listen importieren | Nothing imported yet. · Import lists |
| Vertraute Server | Noch kein Server. · Verbindungsdatei einlesen | No server yet. · Import connection file |
| Sicherungen | Noch keine Sicherung. · Jetzt sichern | No backup yet. · Back up now |
| Erinnerungen (degraded) | Ich konnte deine Erinnerungen nicht laden. Ich zeige nichts als „aus“, solange ich es nicht weiß. · Erneut versuchen | I couldn't load your reminders. I won't show anything as “off” until I know. · Try again |
| Dienste mit Filter | In „{Gruppe}“ ist nichts für dich. · Alle zeigen | Nothing for you in “{group}”. · Show all |
| Suche | Nichts gefunden für „{q}“. | Nothing found for “{q}”. |
| Letzte Sicherung des Servers | noch keine | none yet |

## 6. Alter Ort → neuer Ort (englische Adressen)

Seiten: `/settings/<seite>`, Abschnitte `#<abschnitt>` (wie heute; `?section=` wird weiter verstanden). Eine einzelne Zeile über den vorhandenen Parameter `?match=<zeile>`, eine Dienst-Karte über `?service=<katalog-id>` (beide gibt es schon). Ein Link auf eine Experten-Zeile bei Stufe Standard zeigt sie einmal (B7) — das entspricht dem heutigen `deepLinkedExpert`. Beta-Abschnitte: nur `devices` bleibt bei geschlossenem Tor über einen Link erreichbar **[belegt R23]**; sonst landet der Link auf der Seite ohne den Abschnitt. Ein Nicht-Admin auf einer Admin-Adresse landet auf der nächsten eigenen Seite mit der Zeile „Das gilt für alle Konten. Ändern kann es nur ein Admin.“

### 6.1 Adressen aus dem Auftrag

| Alt | Neu |
|---|---|
| /settings/account#profile | /settings/account#profile (Heimatland, Heimatort, Reisepass: /settings/account#home) |
| /settings/account#security | /settings/account#security |
| /settings/account#devices | /settings/account#devices (auch bei geschlossenem Beta-Tor) |
| /settings/account#notifications | /settings/notifications |
| /settings/account#apitokens | /settings/account#apitokens (Experte) |
| /settings/display#display | /settings/display#language |
| /settings/display#units | /settings/display#units |
| /settings/display#domains | /settings/domains#domains |
| /settings/display#countryCounting | /settings/domains#countryCounting |
| /settings/views#mapAppearance | /dashboard mit offenem Kartenpanel (heutiges `MAP_PANEL_PARAM`); Rückfall /settings/display#views |
| /settings/views#dashboardAppearance | /dashboard; Rückfall /settings/display#views |
| /settings/views#listAppearance | /flights; Rückfall /settings/display#views |
| /settings/trips#trips | /settings/trips#trips |
| /settings/trips#suggestions | /settings/trips#suggestions |
| /settings/trips#sharing | /settings/sharing#accounts (Einladungscodes: /settings/sharing#servers) |
| /settings/trips#calendarFeed | /settings/trips#calendarFeed |
| /settings/companions#companions | /settings/sharing#companions |
| /settings/location#locationProvider | /settings/location#locationProvider |
| /settings/location#travTrack | /settings/location#travTrack |
| /settings/location#dawarich | /settings/services?service=dawarich |
| /settings/location#tripRecording | /settings/location#locationProvider?match=aufz |
| /settings/location#stayScan | /settings/location#stayScan |
| /settings/loyalty#loyalty | /settings/loyalty |
| /settings/privacy#shareLinks | /settings/sharing#shareLinks |
| /settings/privacy#comparisonConsent | /settings/sharing#compare?match=rangliste |
| /settings/privacy#encryptedGrants | /settings/sharing#compare?match=verschl |
| /settings/flight#homeAirport | /settings/flight#homeAirport (Wohnort: /settings/account#home) |
| /settings/flight#autoupdate | /settings/flight#autoupdate |
| /settings/flight#features | /settings/flight#features |
| /settings/flight#defaults | /settings/flight#defaults |
| /settings/flight#enrichment | /settings/flight#enrichment (Experte) |
| /settings/cruise#cruisePreferences | /settings/cruise#cruisePreferences |
| /settings/data#backup | /settings/data#backup |
| /settings/data#import | /settings/data#import |
| /settings/services#externalServices | /settings/services |
| /admin/instance#instance | /settings/server#general |
| /admin/instance#travTrack | /settings/server#features?match=ttoffer |
| /admin/instance#travPlan | /settings/server#features?match=tpoffer |
| /admin/instance#shareLinks | /settings/sharing#shareLinks?match=linkserlaubt |
| /admin/instance#importMode | /settings/server#features?match=importmodus |
| /admin/instance#usageStats | /settings/services?service=usageStats |
| /admin/instance#about | /settings/about |
| /admin/instance#federation | /settings/services?service=federation |
| /admin/instance#push | /settings/services?service=push |
| /admin/users | /settings/users#accounts (`?user=<id>` bleibt) |
| /admin/invitations | /settings/users#invitations |
| /admin/externalServices | /settings/services (`?service=<id>` bleibt) |
| /admin/parsers#parsers | /settings/server#parsers |
| /admin/parsers#templateRepo | /settings/services?service=updatesTemplates |
| /admin/smtp | /settings/services?service=smtp |
| /admin/backups#backups | /settings/backups |
| /admin/backups#webdav | /settings/services?service=webdav |
| /admin/timeModel | /settings/maintenance#timeModel |
| /admin/logging | /settings/maintenance#logging |
| /admin/system | /settings/maintenance#system |
| /admin/airlinesMasterData | /settings/masterdata#catalogues?match=md_airlines |
| /admin/aircraftMasterData | /settings/masterdata#catalogues?match=md_aircraft |
| /admin/airportsMasterData | /settings/masterdata#catalogues?match=md_airports |
| /admin/shipsMasterData | /settings/masterdata#catalogues?match=md_ships |
| /admin/portsMasterData | /settings/masterdata#catalogues?match=md_ports |
| /admin/lodgingChainsMasterData | /settings/masterdata#catalogues?match=md_chains |

### 6.2 Weitere Adressen, die der Router heute kennt (Anhang 2 der Antworten)

| Alt | Neu |
|---|---|
| /settings (ohne Seite) | zuletzt besuchte Seite; beim ersten Besuch /settings/domains |
| /settings?section=<abschnitt> oder /settings#<abschnitt> | wie heute: Seite aus dem Abschnitt, dann Tabelle 6.1 |
| /settings?tab=<seite> | /settings/<seite>, dann Tabelle 6.1 |
| ?section=apiKeys, ?section=apikeys | /settings/services |
| ?section=lodgingMemberships, flightMemberships, cruiseMemberships | /settings/loyalty |
| ?section=domainColors, ?section=modules, /settings#modules | /settings/domains#domains |
| ?section=about | /settings/about (für alle) |
| ?section=lodgingPreferences, /settings/lodging, /settings?tab=lodging | Admin: /settings/services?service=geocoder&expert=1; sonst /settings/display |
| ?section=admin | Admin: /settings/server; sonst /settings/account |
| /settings/flight, /settings/cruise bei ausgeschalteter Reiseart | die Seite mit „{Reiseart} ist aus.“ und „Einschalten“; Abschnitt wird gezeigt, nicht verworfen |
| ?service=<katalog-id> | bleibt: öffnet die Dienst-Karte auf /settings/services |
| ?match=, ?expert=1 | bleiben: Treffer markieren, Experten-Zeile einmal zeigen |
| ?user=<id> | bleibt: /settings/users#accounts mit diesem Konto |
| /admin, /admin?tab=general | /settings/server |
| /admin?tab=flight | /settings/masterdata#catalogues?match=md_airlines |
| /admin?tab=cruise | /settings/masterdata#catalogues?match=md_ships |
| ?section=cruiseMasterData | /settings/masterdata#catalogues?match=md_ships |
| ?section=airlineAircraftMasterData | /settings/masterdata#catalogues?match=md_airlines |
| Admin ?section=apiKeys / apikeys | /settings/services |
| /admin/<Stammdaten> bei ausgeschalteter Reiseart | /settings/masterdata mit Abhängigkeit „{Reiseart} ist aus.“ |
| /parser | bleibt die eigene Route (Parser-Werkzeug), nicht Teil der Einstellungen |

## 7. Offene Fragen

### 7.1 Entschieden (Runde 2)

1 Wohnort = Heimatort: ja · 2 Zuhause ins Profil: ja · 3–6 Dienste, WebDAV, Admin-Seiten, Links: angenommen · 7, 8 Routen/Sitzplätze: gestrichen · 10 Stufen: angenommen, Schlüssel sind Standard · 13 Hell/Dunkel: nicht anbieten · 14 Konto löschen: wird gebaut · 15 Felder ohne Bedienung: alle vier gestrichen · 17 Rollen: nicht in dieser Runde · 22 Adressen: englisch · 26 Speichern: Auswahl bleibt · 11, 12, 16, 18–21, 23–25: Empfehlung gilt (16: Immich-Modus und „Besuchsfotos verknüpfen“ sind eingebaut; 21: Mietwagen-Erinnerung später).

### 7.2 Neu oder weiter offen

| # | Frage | Empfehlung |
|---|---|---|
| 27 | Frist bei Konto löschen. Das Backend gibt es noch nicht (R5). | 30 Tage, Abbrechen durch Anmelden und Knopf. **[Annahme]** im Entwurf. Was in der Frist sichtbar ist: alles wie bisher, plus Statuszeile. Eine Mail am Anfang und 3 Tage vor dem Ende, wenn der Server Mails verschickt. |
| 28 | Demo: Sprache, Zeitzone, Formate, Einheiten, Vorgaben sperrt heute nur die Oberfläche, der Server nicht (R22). | Freigeben. Wer die Demo ausprobiert, will sehen, wie sich das anfühlt; der Demo-Reseed setzt es zurück. |
| 29 | LAN-Adresse wirkt nur beim Strava-Rücksprung (R19). | In die Strava-Karte verlegen (Server-Zeile, Experte) und auf der Server-Seite streichen. Im Entwurf noch auf der Server-Seite mit ehrlicher Kurzzeile. |
| 30 | „Letzte Sicherung des Servers“ zeigt Nicht-Admins heute immer „keine“ (R3). | Bau korrigiert; im Entwurf für alle sichtbar. |
| 31 | Aufenthaltssuche hat in der Datenbank eigene Schalter für Märkte und Orte (`marketEnabled`, `venueEnabled`, R15), das Inventar nennt einen Schalter. | Rückfrage R2-1. Gibt es Bedienung dafür, zwei Schalter unter „Automatisch suchen“ (Standard). |
| 32 | In einer Dienst-Karte mit Konto- **und** Server-Verbindung (Immich, Dawarich, WebDAV) speichert der Admin heute beide mit einem Knopf. | Zwei Gruppen mit je eigenem „Speichern & testen“: „Deine Verbindung“ und „Verbindung des Servers“. Im Entwurf noch eine Gruppe. |
| 33 | SMTP hat laut Katalog keinen Tester, laut Inventar (C5) aber „Test connection“. | Behalten; Rückfrage R2-2. |
| 34 | Bahn-Fahrpläne: Der Katalog-Schalter setzt Transitous und db-rest zusammen, es gibt aber zwei Felder. | Zwei Schalter wie gezeichnet, wenn der Bau sie getrennt schreibt; sonst ein Schalter „Bahn-Fahrpläne“. Rückfrage R2-3. |
| 35 | Altspalte `allowUserFlightApiKeys` und Richtlinie `accountKeysForbidden` laufen nebeneinander. | Nur die Richtlinie anbieten („Eigene Schlüssel erlauben“), Altspalte im Bau entfernen. |
| 36 | Push-Zustimmung: Text und Datum (R16). | Erklärung als Hilfe an „Mitteilungen senden“, das Datum als Statuszeile „Zugestimmt am“. **[Annahme]** zum Wortlaut. |
| 37 | Dienst-Karten für Nicht-Admins: Welche zeigen wir? | Alle Karten, die einem Konto dienen (auch Flugdaten-Dienste des Servers, nur als Pille ohne Chevron); reine Server-Infrastruktur (Mail, Push, Andere Server, Nutzungsstatistik, GitHub, eigenes Routing) gar nicht. Wie Frage 23. |

## 8. Annahmen aus Runde 1 — Stand

| | Runde 1 | Stand |
|---|---|---|
| A-1 | Wohnort und Heimatort meinen dasselbe | **belegt** (Owner) |
| A-2 | Experten-Zeile in Daten › Sicherung = „Versionen behalten“ | **widerlegt R3**: es war „Letzte Instanz-Sicherung“; jetzt Standard-Statuszeile |
| A-3 | Neue Konten landen auf Reisearten | **[Annahme]** bleibt (Frage 11 entschieden: Empfehlung gilt) |
| A-4 | 30 Karten aus 36 Einträgen | **widerlegt R7**: 31 Einträge, 31 Karten |
| A-5 | Dawarich-Instanz für Ländertage | **widerlegt R8**: Instanz nur für Tracks von Touren/Kreuzfahrten und Nachmessung |
| A-6 | „Für mich nutzen“ bei jedem Dienst | **widerlegt R7**: nur bei 10 Diensten (AirLabs, Aviationstack, AeroDataBox, OpenSky, OpenRouteService, GraphHopper, Immich, Dawarich, Strava, WebDAV) |
| A-7 | „profile page“ ist eine eigene Seite | **widerlegt R9**: es ist `/settings/account#profile` |
| neu | Löschfrist 30 Tage | **[Annahme]** (Frage 27) |
| neu | Wortlaut Push-Zustimmung | **[Annahme]** (Frage 36) |
