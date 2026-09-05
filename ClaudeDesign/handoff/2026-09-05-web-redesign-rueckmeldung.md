# Rückmeldung zum Web-Redesign — und Vorschlag für Runde 2

Stand 05.09.2026, abends. Antwort auf den Export „Design setup choices needed"
(33 Screens, `README.md`, `antwort.md`, `design/tokens.json`, `ts-shared.js`),
den Claude Design auf die Übergabe `2026-09-05-web-vereinheitlichung.md`
geliefert hat. Geprüft wurde jeder Screen im Browser bei 1440×900 und sechs
davon bei 390×844; Tokens, `DESIGN_SYSTEM.md` und Handoff im Archiv sind
byteidentisch mit dem Repo-Stand `762cab07`.

Dieses Dokument tut drei Dinge: es hält fest, was angenommen ist; es benennt,
was an den gelieferten Screens zu korrigieren ist; und es listet, was fehlt
und was ich mir darüber hinaus wünsche. Es ist ein Vorschlag des Entwicklers,
kein Beschluss. Owner-Entscheidungen stehen gesammelt in §9.

---

## 0. Kurzurteil

Der Entwurf ist als **Zielbild angenommen**. Shell, Navigationsmodell,
Statuspille, Detailseiten und Primitive sind richtig und besser als der
heutige Stand. Er hat drei inhaltliche Fehler, die vor Block 1 korrigiert
werden müssen, weil jeder spätere Block auf ihnen aufbaut (§2.1–2.3). Er
deckt 24 der 33 heutigen Routen ab (§3), zeigt fast keine Zustände außer
„gefüllt" (§4), keine Dialoge (§5) und ist mobil nicht geliefert (§6).

---

## 1. Was angenommen ist

Diese Punkte gelten ab jetzt als gesetzt. Sie werden nicht mehr diskutiert,
nur noch ausgestaltet.

1. **Die Shell.** Kopfleiste 56 px, vier Primärziele (Dashboard · Logbuch ·
   Reisen · Statistik), Menü „Mehr" mit den Gruppen Sammlungen / Werkzeuge,
   Konto hinter dem Avatar, „Hinzufügen" als einziger Primärbutton. Der
   Posteingang steht im Menü **und** als Icon mit Ungelesen-Punkt. Das
   erfüllt die Owner-Regel vom 05.09. („Posteingang immer über die UI").
2. **Die Logbuch-Familie** als Unterleiste (Flüge · Kreuzfahrten ·
   Unterkünfte · Orte mit Zählern) über einer Tabelle mit 64-px-Zeilen,
   Monogramm-Kachel, Mono-Codes, tabellarischen Ziffern, einer Pille pro
   Zeile und einem Chevron rechts.
3. **Die Detailseiten** (Flug, Kreuzfahrt, Unterkunft, Ort): Hero-Karte mit
   Titel, Pillen und den drei Aktionen; darunter Zweispalter mit
   Abschnittslabels in `.t-label-mono`; rechts die Bezüge (Reise, Flugzeug,
   Datenquelle, Beleg). Die Anreicherungs-Historie mit Quelle und Vertrauen
   im Flug-Detail ist die richtige Antwort auf „woher kommt dieser Wert".
4. **„Hinzufügen" als eine Seite** mit Domänenwahl, dem Parser-Einstieg oben
   („Buchungs-E-Mail oder PDF"), dem Formular darunter und rechts der
   **Vorschau der Auswirkungen** (Statistik +1, Reisepass-Land, Erfolg
   48/50). Das gibt es heute nicht und ist die beste einzelne Idee des
   Entwurfs.
5. **Der Posteingang** als zwei Reiter (Zu prüfen · Flug-Updates), Fragen als
   Karten mit „Passt so" / „Eintrag korrigieren", und dem Grundsatz „nichts
   ändert sich ohne Entscheidung". Das entspricht dem, was der Länder-Beleg
   und die Live-Updates seit 2.6.0 erzeugen.
6. **Reisen** als Jahresgruppen mit Karten, und der **Gruppierungs-Vorschlag**
   als Banner über der Liste („3 Einträge zu einer Reise zusammenfassen").
7. **Der Reisepass v2**: die Zählregel als vier Chips mit Erklärsatz, die
   Kontinent-Kacheln „gemessen an den Ländern, die dieser Katalog kennt",
   die Tabelle mit ausgegrauten „nur umgestiegen"-Zeilen, das Häkchen „Als
   Stempel". Das ist die Darstellung, die der §5-Hinweis heute nur als Prosa
   liefert.
8. **Einstellungen v3**: linker Index in Gruppen (Konto · Darstellung · Daten
   · Dienste), oben Domänen-Reiter (Allgemein · Flug · Kreuzfahrt ·
   Unterkünfte), Auto-Speichern mit Statuszeile. Die Zuordnungsregel „was nur
   eine Ansicht betrifft, sitzt an der Ansicht" ist richtig.
9. **Admin v2** mit den Bereichen wie im Repo, Benutzertabelle mit
   Rollen-Pillen und 2FA-Spalte.
10. **Design Primitives** als Abnahmefläche unter `/design` (nur dev), die
    jedes Primitiv in jedem Zustand mit Token-Bezug zeigt.
11. **Anmelden** als Zweispalter mit Instanz-Selbstauskunft links
    („781 Einträge · 33 Länder · 41 Tage Uptime") und Passkey als
    gleichwertigem Weg.

---

## 2. Korrekturen an den gelieferten Screens

Sortiert nach Tragweite. Die ersten drei sind Systemfehler, die restlichen
sind Einzelstellen.

### 2.1 Dashboard: die Tab-Leiste bleibt, der Modus bleibt pro Domäne

**Befund.** Das Karten-Panel links zeigt unter „Modus" alle Bereiche
gleichzeitig: „Routen" (Flüge), „Seerouten" (Kreuzfahrten), „Marker"
(Unterkünfte), „Marker" (Orte) sind alle zugleich aktiv, darüber ein
Dropdown „Übersicht". Eine Tab-Leiste gibt es nicht mehr.

**Warum das nicht geht.** Heute ist das Dashboard `/dashboard/<tab>?mode=`,
der Modus ist pro Domäne definiert (`types/dashboard.ts`, ein Register mit
`ALL_MODES`, `FLIGHT_MODES`, `CRUISE_MODES`, `POI_MODES`, `LODGING_MODES`,
`TOUR_MODES` und je einem Default), und `localStorage` merkt sich den letzten
Modus je Domäne. Das ist kein Zufall der Implementierung, sondern die
Entscheidung aus 2.4.0, die einen echten Bug entfernt hat: eine Ansicht darf
den Farb- oder Darstellungsmodus nicht implizit setzen. Vier gleichzeitig
aktive Modi in einem Panel sind genau dieser implizite Zustand, nur mit mehr
Chips. Dazu: eine URL, die den Zustand nicht trägt, ist nicht teilbar und
nicht verlinkbar (Discord-Bugmeldungen zeigen heute auf `/dashboard/cruise?mode=itinerary`).

**Vorschlag.** Tab-Leiste behalten: Alle · Flüge · Kreuzfahrten · Unterkünfte
· Orte · Touren (Beta), als dieselbe Unterleiste wie im Logbuch und in der
Statistik (drei Seiten, ein Muster). Unter der Leiste das Karten-Panel mit
**nur den Modi des aktiven Tabs**. Das Panel „Bereiche" links darf bleiben,
aber als Sichtbarkeits-Schalter (welche Domänen zeichnet die Karte im Tab
„Alle"), nicht als Modus-Wähler. Legende und „Sichtbar" rechts sind richtig.

### 2.2 Statistik: Domänen-Serien tragen Domänenfarben

**Befund.** Im Diagramm „Aktivität pro Jahr" ist die Serie Kreuzfahrten mit
`T.chart[1]` (`#6fa0d6`, Blau) gefärbt. Die Domänenfarbe Kreuzfahrt ist
`#4aa6b0` (Türkis). Die Dashboard-Legende, die Logbuch-Unterleiste und die
Bereiche-Kachel benutzen das Türkis. Auf derselben Seite steht die
Kreuzfahrt-Kachel unter „Domänen" mit türkisem Icon neben dem blauen Balken.

**Regel.** Eine Serie, die eine Domäne ist, trägt `domainColor.<key>`. Die
Diagrammpalette `chartColors` ist für Serien **ohne** Domäne: Airlines,
Flughäfen, Kabinenklassen, Länder, Jahre. Das ist der Satz aus Block 4/5 der
Übergabe („Legende und Routen stimmen mit den Domänenfarben der App überein")
und muss auch für Diagramme gelten, sonst sagt Blau in der Statistik
„Kreuzfahrt" und in der Statuspille „Geplant".

**Betroffen.** Statistik (Legende, Balken, Domänen-Kacheln), Design
Primitives (der Diagramm-Block zeigt die Palette, sollte aber daneben zeigen,
wie eine Domänen-Serie aussieht), Erfolg-Detail (Reihen-Diagramm).

### 2.3 Mono-Disziplin

**Befund.** Das eigene Abnahmekriterium sagt: „Mono nur auf Codes, Meta,
Messwerten; nie auf Pillen, Buttons, Namen." Im Flug-Detail stehen in IBM
Plex Mono: „Kurzstrecke · Privat", „Kreditkarte · 28.03.2026", „Miles & More
· +1 250 Meilen", „Economy · Tarif Light", „12 Jahre · gebaut 2014". Im
Unterkunft-Detail: „Standard", „Frühstück", „beCircle · automatisch",
„Nominatim · bestätigt", „Getränkepaket, Trinkgelder". Im Ort-Detail:
„Wahrzeichen", „Ortssuche (Nominatim) · OSM way/4532910". Gemessen: 612
Inline-Vorkommen von `font-family:'IBM Plex Mono'` über 33 Screens; auf
Detailseiten trägt etwa jede zweite Wertzelle Mono. Die Folge sind hässliche
Umbrüche („Flugzeit 1 h 09 (plan 1 / h 25)") und ein Text, der überall
gleich „technisch" aussieht, sodass der Code nicht mehr heraussticht.

**Regel, prüfbar.** Mono für: IATA/ICAO, Flugnummer, Buchungscode,
Kennzeichen, Mode-S, IMO, Koordinaten, Ticketnummer, Datei- und
Modellnamen, Zeitstempel in Historien, Messwerte mit Einheit. Proportional
für: Kategorien, Klassen, Verpflegung, Programme, Zahlungsarten, Herkunft,
Freitext, Namen jeder Art. Ein Wert, der ein Wort der Sprache ist, ist nie
Mono.

### 2.4 Beta-Kennzeichnung kommt aus dem Register

**Befund.** Der Parser trägt eine „Beta"-Plakette (er ist nicht gegated).
Reisepass, Ortslisten, die Domäne Orte, die KI-Zusammenfassung im
Reise-Detail und die Gerätekopplung in den Einstellungen tragen keine (alle
fünf sind gegated). Richtig markiert sind nur „Bereichsfarben" und „Touren".

**Regel.** Das Register `frontend/src/config/betaFeatures.ts` ist die Quelle.
Heute: `tripAiSummary`, `devicePairing`, `passport`, `domainColors`,
`poiDomain`, `tourRoutes`, `dawarich`. Ein Screen zeigt eine Beta-Plakette
genau dann, wenn sein Einstieg einen Registerschlüssel trägt. Und weil das
Register eine `why`- und `returnsWhen`-Zeile pro Eintrag hat, kann die
Plakette einen Tooltip mit `why` tragen. Der Parser verliert seine Plakette;
oder er wird gegated, aber das ist eine Owner-Entscheidung (§9).

### 2.5 Einzelstellen

| Screen | Befund | Korrektur |
|---|---|---|
| Logbuch Flüge | Letzte Zeile trägt die Pille „FLUG" in Warnfarbe statt „Geflogen" | Statuspille aus `STATUS`, Domänenpille nur in gemischten Listen (Reise-Detail, Primitive §07) |
| Logbuch Flüge | Flaggen als einfarbige Rechtecke | Echte Flaggen gibt es seit forgejo#91 als Endpunkt (`/api/v1/country-flags/:cc`); Kachel 18×13, Radius 2, Hairline |
| Logbuch Flüge / Domänen | „Orte 0" vs. „Orte 118", „Kreuzfahrten 22" vs. „21" zwischen Screens | Demodaten einmal festlegen (`ts-shared.js`) und überall daraus lesen |
| Statistik | Jahres-Chips 2015–2026 als Zeile; bei 20 Jahren bricht sie, mobil ist sie abgeschnitten | Chips bis 8 Jahre, darüber Segment „Jahr ▾" mit Dropdown; „Alle" und „Vergleich mit" bleiben Chips |
| Reise-Detail | Tabs Übersicht · Timeline · Karte · Galerie · Logistik · Touren, es fehlt **Journal** | Der Tab existiert heute (`TripDetailPage.tsx`: `journal`); ergänzen |
| Reise-Detail | „Zusammenfassung erstellen" ohne Beta-Plakette | siehe 2.4 |
| Kreuzfahrt-Detail | „Kartenfarbe" mit sechs freien Farbpunkten | Das ist der freie Farbwähler, den der Companion abgeschafft hat; ersetzen durch `listColor` (zehn benannte) oder streichen (§9) |
| Einstellungen v3 | Eine Seite, 6486 px hoch, 98 KB | Der linke Index muss Routen sein (`/settings/account`, `/settings/display`, …), nicht Sprungmarken; eine Gruppe pro Seite bei `reading`-Breite |
| Einstellungen v3 | „Kein Sheets-Sync" — der heutige `SpreadsheetSection` ist aber der **Excel-Export** des Nutzers, kein Sync | Excel-Export bleibt unter Daten → Meine Daten; der Admin-„Daten-Export" ist etwas anderes |
| Einstellungen v3 | Immich nur im Admin unter „Externe Dienste" | Heute gibt es zusätzlich eine **Nutzer**-Verbindung (`ImmichConnectionCard`, eigener API-Key hat Vorrang) — Dienste → Immich ergänzen, analog zu API-Schlüsseln |
| Einstellungen v3 | Dawarich fehlt | `DawarichConnectionCard` existiert (Beta) — Dienste → Dawarich (Beta) |
| Anmelden | „Ersteinrichtung ansehen · Alle Screens" als Fußzeile | Prototyp-Navigation; im Produkt weg |
| alle | 23 Hex-Werte außerhalb `tokens.json` (Airline-Monogramme, Reise-Cover-Verläufe, Flaggenfarben) | Monogramm-Kacheln: `tile` + Text in `textBright`; Cover ohne Foto: `heroGradient`; Flaggen: echte Flaggen |
| Design Primitives | Diagramm-Block zeigt nur die Palette | dazu: eine Domänen-Serie, eine gemischte Serie, ein Diagramm bei 300 px Breite (das Kriterium „nie geclippt") |

### 2.6 Eine Messung, die der Entwurf selbst nicht gemacht hat: Kontrast

Berechnet nach WCAG auf den Token-Werten:

| Text | auf | Kontrast | Urteil |
|---|---|---|---|
| `muted` (Tinte 60 %) | `surface` | 5,7 : 1 | AA für Fließtext |
| `faint` (Tinte 45 %) | `surface` | 3,8 : 1 | **unter AA (4,5) für Text unter 18 px** |
| `silver` (Tinte 62 %) | `surface` | 6,0 : 1 | AA |
| `accent` | `bg` | 9,7 : 1 | AAA |
| `paperText` | `paper` | 13,7 : 1 | AAA |
| `info` / `cruise` | `surface` | 6,5 / 6,3 : 1 | AA |

`faint` wird im Entwurf für Sekundärzeilen in Tabellen (11–12 px), Fußnoten
und Platzhalter benutzt. Es ist nur für Text ab 18 px oder für dekorative
Elemente zulässig. Vorschlag: `faint` bleibt für Trennzeichen, Platzhalter
in leeren Feldern und Icon-Ruhezustand; jede lesbare Zeile nimmt `muted`.
Das ist eine Änderung an der **Verwendung**, nicht am Token; sie gehört in
`DESIGN_SYSTEM.md` §3 und als Zeile in die Primitive.

---

## 3. Was fehlt: Screens gegen die Route-Liste

Heutige Routen (`frontend/src/App.tsx`, 33) gegen die 33 Screens des Exports.
„Versionen" (Einstellungen v1–v3, Admin v1/v2, Reisepass v1/v2) zählen als
je ein Screen; Index und Primitive sind keine Produktseiten.

| Route heute | Screen im Export | Fehlt |
|---|---|---|
| `/login`, `/2fa` | Anmelden (2FA als Zustand erwähnt) | der 2FA-Schritt selbst, der Passkey-Fehlerfall („kein sicherer Kontext") |
| `/register`, `/reset-password`, `/change-password` | Registrieren, Passwort | erzwungener Passwortwechsel (`mustChangePassword`) als eigener Zustand |
| `/setup` | Einrichtung | — |
| `/dashboard/:tab` | Dashboard | Tabs (§2.1), Touren-Tab, Heatmap, Globus (nur Platzhalter-Kreis), Trip-Modus, Aktivitäts-Seitenleiste (nur der Knopf) |
| `/flights`, `/flights/:id` | Logbuch Flüge, Flug-Detail | Bearbeiten-Formular, Duplikat-Hinweis, Lookup-Vorschlag beim Anlegen |
| `/aircraft/:registration` | **keiner** | Flugzeug-Seite (Kennzeichen, Typ, alle Flüge mit dieser Maschine) |
| `/cruises`, `/cruises/:id` | Logbuch Domänen, Kreuzfahrt-Detail | Stops-Editor (3-Zustands-Invariante: Hafen / Seetag / unaufgelöster Hafen), „Hafen auflösen" |
| `/lodging`, `/lodging/:id`, `/lodging/chains/:id` | Logbuch Domänen, Unterkunft-Detail, Kette-Detail | Aufenthalt-Formular, Bewertungsdialog |
| `/places`, `/places/:id` | Logbuch Domänen, Ort-Detail | Ort-Suche (Nominatim) beim Anlegen |
| `/places/lists`, `/places/lists/:id`, `/places/checklists/:key` | Ortslisten | **Listen-Detail** (die Orte einer Liste mit Fortschritt), **kuratierte Checkliste** (UNESCO etc., andere Semantik: Katalog, nicht Nutzerliste) |
| `/trips`, `/trips/:id` | Reisen, Reise-Detail | fünf von sechs Tabs nur benannt; Journal fehlt ganz (§2.5) |
| `/trips/:id/route/:routeId` | Routeneditor | Der Export zeigt einen **Kreuzfahrt**-Etappen-Editor. Die heutige Route ist der **Touren**-Editor (Stopps zuordnen, Etappen, GPX/Dawarich-Tracks). Beides gewünscht, es sind zwei Screens |
| `/stats` | Statistik | Reiter Flüge / Kreuzfahrten / Unterkünfte / Orte nur als Leiste; die Abschnitte (Airlines, Flughäfen, Flugzeuge, Pünktlichkeit, Kosten, Häfen, Reedereien, Ketten) fehlen alle |
| `/achievements` | Erfolge, Erfolg-Detail, Bestenliste | — |
| `/passport` | Reisepass v2 | Stempel-Ansicht („Als Stempel" ist nur ein Häkchen), Druckansicht |
| `/pending-updates` | Posteingang | Reiter „Flug-Updates" (nur der Zähler), Diff-Ansicht alt/neu |
| `/parser` | Parser | Annotations-Ansicht selbst (Text markieren), Template-Detail, Parse-Log-Zeile |
| `/settings` | Einstellungen v3 | siehe §2.5; dazu **Import-Logbuch** (welche Datei wann was angelegt hat), Backup-Wiederherstellung |
| `/admin` | Admin v2 | nur „Benutzer" gezeichnet; die zwölf anderen Bereiche sind Indexeinträge; **Stammdaten-Editor** (Airlines, Flugzeuge, Flughäfen, Schiffe, Häfen) fehlt komplett |
| `*` | Nicht gefunden | — |
| — | **keiner** | „Was ist neu"-Dialog (`WhatsNewModal`, seit 2.6.0 mit Beta-Plakette pro Punkt) |
| — | **keiner** | Flug-Zertifikat (`FlightCertificate.tsx`, heute mit eigener Papierpalette — sollte auf `paper` wie der Reisepass) |

Zählung: **9 Routen ohne Screen**, weitere 8 nur als Hülle.

---

## 4. Was fehlt: Zustände

Der Export zeigt jede Seite genau einmal, gefüllt mit guten Daten. Die
Übergabe (§5) nannte „Offline und Leere sind gestaltete Zustände (vier
Arten), nie rot". Die Primitive zeigen die vier Arten als Kacheln; **keine
einzige Produktseite** zeigt sie.

Pro Seite werden gebraucht, als eigene Artboards oder als Varianten:

1. **Leer, erstes Mal.** Frisches Konto, null Einträge. Dashboard ohne Karte
   ist eine Einladung („Erste Buchung einlesen"), nicht ein leerer Globus.
   Logbuch, Reisen, Statistik, Reisepass, Erfolge je einmal.
2. **Leer durch Filter.** „Kein Flug 2019 mit Filter Langstrecke" ist etwas
   anderes als „kein Flug"; die Antwort ist „Filter zurücksetzen".
3. **Leer, Domäne aus.** Unterkünfte deaktiviert → Logbuch-Unterleiste ohne
   den Reiter, Statistik ohne die Kachel, Dashboard ohne den Bereich. Heute
   gemessen: zwei Gate-Lecks in 2.6.0-rc.31 genau an dieser Stelle.
4. **Laden.** Skeleton mit der Form der späteren Karte, nicht Spinner.
   Tabellen: 8 Skelettzeilen bei 64 px.
5. **Fehler.** Anfrage 5xx, Backend nicht erreichbar, Sitzung abgelaufen
   (401 → Anmelden mit Rücksprung). Die Übergabe hat das gemessen: heute
   stehen an mehreren Stellen Nullen über einer Fehlermeldung.
6. **Teilweise.** Ein Flug ohne Zeiten (nur Datum), eine Kreuzfahrt mit einem
   unaufgelösten Hafen, eine Unterkunft ohne Koordinaten, ein Ort ohne Datum.
   Das sind die Fälle, die die Zählregeln (`null`, nie 0) sichtbar machen
   müssen: „—" mit Tooltip „nicht ableitbar", nie „0".
7. **Beta aus.** Jede Seite einmal ohne Beta-Schalter. Das ist der Zustand,
   den ein Prod-Nutzer heute sieht.

Für den Reisepass zusätzlich: Konto mit einem Land, Konto mit 120 Ländern.
Für die Statistik: Jahr ohne Einträge bei gewähltem Vergleich.

---

## 5. Was fehlt: Dialoge und Formulare

Die Übergabe hat 24 eigene Overlays gemessen und eine Shell gefordert. Der
Export zeigt die Shell in den Primitiven (§09, ein Knopf „Dialog öffnen") und
sonst nirgends. Jedes Formular ist im Export eine Seite („Hinzufügen") oder
gar nicht da („Bearbeiten" ist überall ein Knopf ohne Ziel).

Benötigt, je einmal in der Shell (surface2, Radius 26, Scrim, Fokusfalle,
Escape, eine Primäraktion im Footer, unter 640 px unten angedockt):

| Dialog | Heute | Anmerkung |
|---|---|---|
| Bestätigen (Löschen) | `ConfirmModal` | Danger-Button nur hier; Text nennt, was verschwindet und was bleibt („Die Reise bleibt, der Flug verschwindet aus ihr") |
| Flug bearbeiten | Modal | Dasselbe Formular wie „Hinzufügen", ohne Parser-Einstieg |
| Kreuzfahrt bearbeiten + Stops-Editor | `CruiseEditModal` (11 eigene Hexes) | Der Stops-Editor ist der schwierigste Dialog der App: Reihenfolge, Tagnummern, drei Zustände pro Stop |
| Unterkunft / Aufenthalt bearbeiten | Modal | Aufenthalt als Karte im Haus; Bewertung Zimmer/Frühstück/Service |
| Ort anlegen mit Suche | Modal | Nominatim-Treffer als Liste mit Karte |
| Reise anlegen / zuordnen | Modal | „Zu welcher Reise gehört dieser Eintrag" ist der häufigste Dialog nach dem Import |
| Import-Vorschau | Seite/Modal | Nach dem Parsen: gefundene Felder, Vertrauen pro Feld, Duplikat-Warnung, Speichern |
| Live-Update anwenden | Posteingang | Diff alt/neu pro Feld |
| Passwort ändern, 2FA einrichten (QR + Codes), Passkey registrieren | drei Modals | Sicherheits-Ceremonien: jeder Schritt sichtbar, kein Auto-Weiter |
| Gerät koppeln (QR) | Einstellungen | ist im Export als Karte da; der Ablauf (Code läuft ab, Gerät bestätigt) fehlt |
| Bild-Viewer (Galerie, Beleg) | eigenes Overlay | einziger Dialog ohne Footer; Pfeile, Escape, Zoom |
| „Was ist neu" | `WhatsNewModal` | Highlights mit Beta-Plakette; seit 2.6.0 acht Punkte |
| Toast | eigenes | Ruhig, unten rechts, nie für Fehler eines Formulars (die stehen als Zeile am Feld — Primitive §06 sagt das richtig) |

---

## 6. Mobil

Die Übergabe verlangte pro Screen 1440×900 **und** 390×844. Geliefert ist
Desktop. Bei 390 px gemessen:

- **Dashboard**: die drei rechten Panels (Als Nächstes, Sichtbar, Legende)
  liegen absolut positioniert über dem linken Panel; nichts ist lesbar.
- **Logbuch Flüge**: die Tabelle läuft aus dem Viewport, der Body scrollt
  horizontal. Das Kriterium „die Seite scrollt nie horizontal" ist gerissen.
- **Reise-Detail**: „Kreuzfahrt" und „Reisende" überlagern sich, die
  Ortsliste ist 40 px breit, „Notizen" umbricht wortweise.
- **Statistik**: Jahres-Chips abgeschnitten (nur 2015, 2016 sichtbar).
- **Einstellungen v3**: funktioniert, weil einspaltig, aber 9335 px hoch.
- **Reisepass v2**: funktioniert, die Tabelle wird zur Liste.

**Was ich mir wünsche.** Nicht „Desktop kleiner", sondern eine
Mobil-Regel pro Primitiv, festgelegt einmal:

| Primitiv | unter 640 px |
|---|---|
| Tabelle | wird ListRow: Zeile 1 Titel + Pille, Zeile 2 Meta, rechts Chevron; die Spaltenwahl entfällt |
| Zweispalter (Detail) | rechte Spalte rutscht unter die linke; Reihenfolge bleibt |
| Karten-Panels (Dashboard) | ein Bottom-Sheet „Karte" mit Modus/Ebenen/Legende als Reiter; Karte bekommt den ganzen Viewport |
| Chip-Zeile | horizontal scrollbar mit Fade rechts; nie umbrechen |
| Hero (Reise, Flug) | Titel bricht, Aktionen wandern in „…" |
| Kopfleiste | Primärziele in ein Bottom-Tab-Bar? **Nein** — der Companion hat die Quickbar, das Web bleibt bei Top-Nav mit „Mehr"; unter 640 px wird „Mehr" zum vollen Menü inkl. der vier Primärziele |
| Dialog | dockt unten an (ist so festgelegt) |

Und eine Tablet-Stufe (768–1024) für die Fälle, in denen jemand das Web auf
dem iPad benutzt, weil der Companion dort noch nicht optimiert ist.

---

## 7. Was ich mir darüber hinaus wünsche

Das ist der Teil jenseits der Übergabe. Sortiert nach dem, was ich für den
größten Gewinn pro Aufwand halte.

### 7.1 Der Globus als Signaturmoment, nicht als Platzhalter

Die Companion-Charta nennt drei Signaturmomente: Globus, Reisepass,
Jahresrückblick. Der Reisepass ist geliefert und gut. Der Globus ist ein
schraffierter Kreis mit dem Text „GLOBUS · MAPLIBRE · ROUTEN AUS
DOMÄNENFARBEN". Das ist der erste Bildschirm nach dem Anmelden. Ich wünsche
mir einen Entwurf, der festlegt: Grundfarbe der Kugel und des Ozeans
(`surface2`?), Landmasse (`tile`?), Atmosphären-Rand, Routenbreite, Glow ja
oder nein, wie eine ausgewählte Route sich absetzt, wie die Zeitleiste unter
der Kugel aussieht (der Slider „2015 — 2026" ist da), was beim Hover auf
einen Flughafen erscheint. Heute ist das alles in `MapContainer3D` und den
Layern hart codiert.

### 7.2 Der Jahresrückblick

Fehlt komplett, im Web wie im Export. Eine Seite `/review/2026` (oder ein
Reiter in der Statistik): Kacheln in Hero-Größe, ein Satz pro Domäne
(„12 Flüge, 3 neue Länder, die längste Strecke war FRA–ANC"), die Karte des
Jahres, die Erfolge des Jahres, teilbar als Bild. Das ist der Moment, in dem
jemand TravStats jemandem zeigt. Er braucht `paper` oder `heroGradient`,
`.t-hero`, die Diagrammpalette, und er ist die natürliche Heimat der
„Vergleich mit 2025"-Funktion.

### 7.3 Eine Schnellsuche über alles

`Ctrl+K` / `⌘K`: Flugnummer, Buchungscode, Flughafen, Schiff, Hotel, Ort,
Reise, Seite. Ergebnis mit Domänen-Icon und Pille, Enter öffnet. Heute hat
jede Liste eine eigene Suche, es gibt keinen Weg von „ich weiß, ich war mal
in Skagway" zu dem Eintrag. Die Kopfleiste hat Platz dafür zwischen den
Primärzielen und dem Posteingang.

### 7.4 Die Vorschau der Auswirkungen ausbauen

Der Export zeigt sie beim Anlegen. Ich wünsche sie auch beim **Bearbeiten**
(„Status auf Storniert: Statistik −1 Flug, Reisepass unverändert, Erfolg
‚Vielflieger 50' fällt auf 46/50") und beim **Löschen** im
Bestätigungsdialog. Das ist dieselbe Komponente, drei Orte. Und sie ist die
UI-Antwort auf die „Abstinenz ist ein Ergebnis"-Regel: eine Vorschau, die
sagt „Distanz: nicht ableitbar, bis das Flugzeug gelandet ist".

### 7.5 Das Import-Logbuch als Seite

Heute versteckt unter Einstellungen → Importe. Es gehört als vierter Reiter
in den Posteingang oder als eigene Seite unter Werkzeuge: jede Datei, jeder
Parse, was angelegt wurde, was verworfen wurde, mit Sprung zum Eintrag. Das
ist die Frage „wo kommt dieser Flug her", die heute niemand beantworten kann.

### 7.6 Tastatur als Systemzustand, nicht als Fußnote

Der Export zeigt in „Hinzufügen": „Tastatur: ⌘ Enter speichert, Esc bricht
ab." Ich wünsche mir die Regel für alle Seiten: `j`/`k` in Listen, Enter
öffnet, `e` bearbeitet, `n` neu, `/` fokussiert die Suche, `g d` / `g l` /
`g r` / `g s` springen zu den Primärzielen, `?` zeigt die Liste. Fokusring
ist als Token da; die Reihenfolge der Tabstopps in der Tabelle (Zeile als ein
Stopp, Aktionen darin) muss festgelegt werden, weil heute eine klickbare
Zeile die Zeilen-Aktionen bricht (gemessen im August).

### 7.7 Druck- und Export-Ansichten auf `paper`

Reisepass „Drucken" ist als Knopf da. Ich wünsche mir die Druckansicht
gezeichnet (A4, `paper`, `paperText`, Newsreader für den Titel, Stempel als
Option) und dieselbe Fläche für das Flug-Zertifikat, das heute eine eigene
Papierpalette hat. Zwei Dokumente, eine Papierfarbe.

### 7.8 Ein Tag-Konzept

Kreuzfahrt-Detail zeigt `#alaska #gletscher #familie`. Tags gibt es heute an
Flügen, Reisen und Kreuzfahrten (`String[]`, freier Text, ohne Vokabular),
aber keine Regel für ihre Darstellung und keinen Ort, an dem man alle sieht.
Der Entwurf braucht: Chip mit Hairline, klein, ohne Farbe (Farbe trägt
Bedeutung, Tags tragen keine), klickbar als Filter in der jeweiligen Liste,
Vorschlag aus den vorhandenen Tags beim Tippen, und eine Tag-Übersicht
(Statistik oder Logbuch-Filter). Unterkünfte und Orte haben keine Tags;
entweder bekommen sie welche, oder der Entwurf zeigt sie dort nicht.

### 7.9 Mitreisende als Personen

Zwei Screens zeigen „Mitreisende" mit Initialen-Avataren. Die Entität gibt es
(`Companion` mit Verknüpfungen zu Flug, Reise, Kreuzfahrt; dazu die aus
Buchungs-E-Mails geparsten `coPassengers` als eigenes Feld), aber **keine
Verwaltungsseite**: Mitreisende entstehen nur als Nebenprodukt eines
Eintrags. Ich wünsche mir: Einstellungen → Konto → Mitreisende (Liste,
Umbenennen, Zusammenführen von Schreibvarianten, weil `canonicalName` genau
dafür da ist), einen Filter „mit Mia" in Logbuch und Reisen, und die
Unterscheidung im Detail zwischen „von dir eingetragen" und „aus der Buchung
gelesen". Unterkünfte haben heute keine Mitreisenden; der Export zeigt sie
dort trotzdem.

### 7.10 Eine EN-Fassung von drei Screens

Die Oberfläche ist DE/EN, und EN-Strings sind im Mittel 15–20 % länger
(„Unterkünfte" → „Accommodation", „Abgeschlossen" → „Completed"). Drei
Screens in EN (Logbuch, Einstellungen, Reisepass) zeigen, ob die Pillen, die
Unterleiste und die Kacheln die Länge tragen.

### 7.11 Bewegung

Nichts im Export bewegt sich, und `prefers-reduced-motion` ist als
Media-Query da. Festgelegt werden muss trotzdem: Dialog-Einblenden (Dauer,
Kurve), Sheet-Anfahren von unten, Skeleton-Puls, Pillen-Wechsel beim
Statuswechsel, der Globus beim Laden. Wenige Werte, einmal als Tokens
(`motion.fast` 120 ms, `motion.base` 200 ms, `motion.enter` ease-out), dann
nie wieder diskutiert.

### 7.12 Die Companion-Kopplung als Erlebnis

Die QR-Karte in den Einstellungen ist da. Ich wünsche mir den Moment danach:
„iPhone 15 verbunden — deine 160 Flüge sind in 20 Sekunden auf dem Telefon",
mit dem Companion-Icon und einem Link zum Store. Das ist die eine Stelle, an
der Web und App sich berühren, und der Grund, warum die Vereinheitlichung
überhaupt gemacht wird.

---

## 8. Runde 2 — was Claude Design als Nächstes liefern soll

In dieser Reihenfolge, weil jeder Punkt den vorigen braucht:

1. **Korrekturen §2.1–2.4** an den bestehenden Screens (Dashboard-Tabs,
   Domänenfarben im Diagramm, Mono-Regel, Beta aus dem Register). Dazu die
   Primitive um „Domänen-Serie im Diagramm", „`faint` nur dekorativ" und
   „Tabelle → ListRow unter 640 px" erweitern.
2. **Mobil (§6)** für die sechs Kernseiten: Dashboard, Logbuch Flüge,
   Flug-Detail, Reise-Detail, Statistik, Einstellungen. Mit der
   Primitiv-Regel, nicht Seite für Seite.
3. **Zustände (§4)** für dieselben sechs Seiten: leer-erstes-Mal, laden,
   Fehler, Beta-aus.
4. **Dialoge (§5)**: Bestätigen, Flug bearbeiten, Stops-Editor,
   Import-Vorschau, Reise zuordnen. Fünf reichen, um die Shell zu beweisen.
5. **Fehlende Seiten (§3)**: Flugzeug-Seite, Listen-Detail, kuratierte
   Checkliste, Touren-Editor, Statistik-Abschnitte Flüge, Admin →
   Stammdaten. Sechs Seiten.
6. **Signaturmomente (§7.1, 7.2, 7.7)**: Globus, Jahresrückblick,
   Druckansicht. Das sind die drei, die man zeigt.
7. Alles aus §7.3–7.12 ist Wunschliste für Runde 3 oder für den Weg über
   das Backlog; nichts davon blockiert Block 1.

Lieferform wie in der Übergabe: PNG 1440×900 und 390×844 mit denselben Namen,
`NN-antwort.md` mit „gebaut / offen / Frage an den Owner". Token-Änderungen
zuerst in die Companion-Datei, dann per Kopie hierher. Und eine Bitte an das
Werkzeug: die Demodaten einmal in `ts-shared.js` festlegen und alle Screens
daraus lesen lassen, dann verschwinden die Zähler-Widersprüche von selbst.

---

## 9. Entscheidungen für den Owner

Aus `antwort.md` (1–4), aus der Übergabe (5–9) und neu aus dieser Rückmeldung
(10–13). Mit meiner Empfehlung, die nichts vorwegnimmt.

| # | Frage | Empfehlung |
|---|---|---|
| 1 | Ortslisten und Admin als eigene Seiten; Listen-Fortschritt aus besuchten Orten abgeleitet? | **Ja.** Entspricht dem Backend (`placeCounting`). Die kuratierten Checklisten brauchen aber ein eigenes Muster (Katalog, nicht Nutzerliste). |
| 2 | Developer Mode / LoRA-Training in Nutzer-Einstellungen oder nur Admin? | **Nur Admin.** Training ist Instanz-Ressource. Der Nutzer behält „Parser-Feedback senden" als Schalter. |
| 3 | Öffentliches Profil (Erfolge + Reisepass)? | **Nicht jetzt.** Neues Feature mit Datenschutzfragen, kein Vereinheitlichungsthema. Der Jahresrückblick als Bild deckt den Teil-Wunsch. |
| 4 | Nutzerfarben für Domänen behalten? | **Streichen.** Der Export zeigt selbst, warum: Farbe trägt Bedeutung in Legende, Pille, Statistik. Damit fällt `domainColors` aus dem Beta-Register, und der freie Farbwähler am Kreuzfahrt-Detail geht mit. |
| 5 | BRAND.md §3 und travstats.de nachziehen? | **Ja, nach Block 1**, wenn die ersten echten Screens existieren. Screenshots der Website erst dann erneuern. |
| 6 | Syne auf der Website behalten? | **Ja, nur Website.** Die App hat Hanken Grotesk 800 als Display; die Marketing-Seite darf eine eigene Stimme haben. |
| 7 | Tokens für Zug, Wandern, Rad, Straße, Fähre? | **Ja, ableiten und in die Companion-Datei aufnehmen**, sonst haben Touren keine Farbe, sobald sie aus der Beta kommen. Vorschlag: gedeckte Erdtöne aus der bestehenden Web-Palette, im Companion ratifizieren. |
| 8 | Zeitpunkt | **2.7.0, `dev/design-system`.** Kein Fix am 2.6.0-Stand. |
| 9 | Die 800-Zeilen-Grenze | Unverändert offen, unabhängig hiervon. |
| 10 | Parser gaten (Beta) oder Plakette entfernen? | **Plakette entfernen.** Der Parser ist seit 2.2 produktiv; „Nur Ollama vollständig getestet" gehört als Hinweis in die Parser-Einstellungen, nicht als Beta-Etikett auf die Seite. |
| 11 | Einstellungen als eine Seite oder als Routen pro Gruppe? | **Routen pro Gruppe** (`/settings/account` …). 6486 px sind kein Formular. |
| 12 | Dashboard-Tabs behalten (§2.1)? | **Behalten.** Das ist die 2.4.0-Entscheidung; sie steht in CLAUDE.md als Invariante. |
| 13 | Mitreisende und Tags: nur zeigen, wo die Daten sie heute tragen (Flug, Reise, Kreuzfahrt), oder auf Unterkünfte und Orte ausdehnen? | **Erst zeigen, wo sie existieren**, plus die Verwaltungsseite aus §7.9. Die Ausdehnung ist eine Datenmodell-Entscheidung, kein Design-Detail. |

---

## Anhang A — Messung des Exports (05.09.2026)

- 33 `.dc.html`, 1,1 MB; `ts-shared.js` 17 KB (Tokens `T`, Domänen, Status,
  Nav-Modell, Lucide-Sprite); `support.js` 69 KB generierte Laufzeit
  (React-basiert, `<x-dc>`-Templates mit `{{ }}`).
- Tokens im Export = Repo (`design/tokens.json`), byteidentisch. 34 Hex-Werte
  in den Tokens; **23 fremde** in den Screens, davon 15 in `Logbuch Fluege`
  (Airline-Monogramme, Flaggenfarben), 6 in Reise-Cover-Verläufen, 3 in
  `support.js` (Laufzeit-Fehleranzeige, nicht Produkt).
- Schriften: eine Google-Fonts-Zeile pro Screen (Hanken Grotesk 400–800, IBM
  Plex Mono 400–600, Newsreader kursiv 400/500). Mono-Vorkommen inline: 612.
- Emoji: keine. Icons: Lucide-Sprite, ~70 Pfade.
- `prefers-reduced-motion` respektiert; `:focus-visible` mit `focusRing`.
- Kein `<table>`: Tabellen sind Grid-Zeilen (gut für die ListRow-Regel,
  schlecht für Screenreader — Rollen `row`/`cell` ergänzen).
- Konsole beim Rendern: pro Screen 1–3 404 auf eine Ressource der Laufzeit
  (kein Produktinhalt).
- Mobil 390 px: Dashboard, Logbuch, Reise-Detail, Statistik defekt (§6);
  Einstellungen, Reisepass funktionsfähig.
