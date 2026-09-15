# Runde 4 — Vollständige Vereinheitlichung (Handoff 15.09.2026)

Stand 15.09.2026 · 52 Screens · Referenz `dev/design-system @ 51ea0549` · Einstieg `Index.dc.html`.
Lieferung nach HANDOFF §7: 1 Gesamtentwurf + Prototyp (alle `*.dc.html`), 2 Komponentenübersicht (`Komponenten.dc.html`), 3 Vergleichstafeln (`Vergleich.dc.html`), 4 Routen-/Zustandsmatrix (`Matrix.dc.html`, `ROUTENMATRIX.csv`), 5 Entscheidungsprotokoll, 6 Umsetzungsliste, 7 Token-Abgleich — die letzten drei stehen hier.

## Nachtrag 15.09. — Statistik-Tabs Kreuzfahrten · Unterkünfte · Orte
Gebaut nach `stats.cruiseSection`, `lodging.stats.*` (money/quality/geo/rhythm/loyalty/records) und `places.stats.*`. Drei Bausteine (Kennzahl-Kachel mit Erläuterung, Ranking mit Balken, Säulen) in Domänenfarbe; Fußnoten für „ohne Datum“, „ohne Koordinaten“, „doppelt gebucht“. Route `/stats?tab=cruise|lodging|poi`.

## 5 · Entscheidungsprotokoll

| # | Geändert gegenüber Beta | Löst | Verworfene Alternative | Warum verworfen |
|---|---|---|---|---|
| E1 | Kopfzeile: 4 Primärziele (Dashboard · Logbuch · Reisen · Statistik), „Mehr“ (Sammlungen, Werkzeuge), Posteingang-Icon mit Punkt, Konto-Menü; < 640 px falten Primärziele in „Mehr“, Hinzufügen wird Icon | D-01: Standort und Haupteinstieg pro Seite eindeutig | Seitenleiste (Rail) links | Konkurriert mit Karten-Panels und Detail-Zweispaltern um Breite; Owner-Zielbild ist die Kopfzeile |
| E2 | Domänen als Tabs im Dashboard; Modus gehört zum Tab, Sichtbarkeit/Legende/Ebenen getrennt | §C: Domäne, Modus, Filter dürfen sich nicht unbemerkt umschalten | Ein globaler Modus-Schalter über alle Domänen | Modi sind pro Domäne verschieden (Routen ≠ Seerouten ≠ Marker) |
| E3 | Karten-Panels klappbar in zwei Spalten, Zeitachse unten Mitte; < 640 px ein Bottom-Sheet „Karte“ mit Reitern Modus/Ebenen/Legende/Sichtbar, Zustände geschlossen/Vorschau/erweitert | D-03: Flächenkonkurrenz, Attribution bleibt frei | Schwebende Panels wie Beta | Überlagern sich bei 390 px, Attribution verdeckt |
| E4 | Logbuch < 640 px als ListRow: Route + Status, darunter Datum · Flugnummer · Dauer; Spaltenwahl nur Desktop | D-02, §A: Route/Datum/Status ohne Scrollen | Horizontale Tabelle mit fixierter erster Spalte | Kerninformation läge weiterhin rechts außerhalb |
| E5 | Filter als Chips: aktiv sichtbar, einzeln ×, „Zurücksetzen“; „keine Treffer“ ≠ „keine Einträge“ ≠ „Laden fehlgeschlagen“ | §A Filterzustand, §6 Zustände | Filter im Seitenpanel | Versteckt aktive Filter |
| E6 | Eine Detail-Familie: Zurück-Link, Kopfkarte (Titel, Pille, Metazeile, Aktionen rechts), Kennzahlen-Streifen, Zweispalter 1,5 : 1, Abschnittstitel mono-uppercase | D-08: Kreuzfahrt-Detail brach die Familie | Domänenspezifische Köpfe | Unterschiede waren nicht durch Inhalt begründet |
| E7 | Statuspillen: ein Wortschatz (Geplant/Vorläufig/Geflogen/Storniert/Live/Historisch …), immer Text + Farbe, gestrichelt = vorläufig; Datum ISO `YYYY-MM-DD` mono in Tabellen, `DD.MM.YYYY` in Fließtext, Zeiten `HH:MM` mit Ortszeit-Hinweis | D-07: SCHEDULED / Scheduled / drei Datumsformate | Lokal formatiertes Datum in Tabellen | Nicht sortier-/vergleichbar, springt zwischen Sprachen |
| E8 | Reisepass v2: Kopfzahl „gezählt / mit Nachweis“, vier Nachweisstufen, Zählregel wählbar, nicht gezählte ausgegraut statt versteckt, „—“ vs. „unbekannt“ vs. 0 erklärt; mobil kompakte Länderzeile, Erklärung aufklappbar | D-04, §D | Nur gezählte Länder zeigen | Nutzer könnte falsche Einstufung nicht korrigieren |
| E9 | Papier bleibt: Reisepass-Druck und Flug-Zertifikat auf `paper`/`paperText`, Newsreader nur dort | D-06 (Kontrast 13,7 : 1), Wiedererkennung | Papier auch im Web-Reisepass | Bricht das dunkle Gesamtbild; Papier nur im Dokument-Kontext |
| E10 | Einstellungen: Alltag zuerst (Konto, Darstellung), Technik hinten (Tokens, Geräte, Daten); Gruppen als Routen vorbereitet; Speicherstatus „Änderungen vorhanden / wird gespeichert / gespeichert / fehlgeschlagen“ in einer Statuszeile | D-05, §6 Speichern | Auto-Save ohne Statuszeile | Widerspruch zu explizitem Speichern in Formularen |
| E11 | Dialoge: eine Shell (surface2, Radius 26, Scrim, Esc, eine Primäraktion, < 640 px angedockt); Danger nur im Bestätigen-Dialog; Fehler am Feld, nie als Toast | §6 Zustände, §A Fehler | Inline-Bearbeitung in Tabellenzeilen | Bei 320 px nicht beherrschbar |
| E12 | Erfassen: ein Einstieg „Womit fangen wir an?“ (E-Mail/PDF · Text · von Hand); Parser-Werkzeug unter Beta getrennt; Import-Vorschau mit Vertrauen pro Feld, Duplikat, „Diesem Hotel zuordnen / Anderes Hotel“, Währung korrigierbar | §B, Owner „Parser im Beta-Register“ | Import als eigener Menüpunkt | Nutzer sucht „Hinzufügen“, nicht „Import“ |
| E13 | Posteingang = Datenqualitätsfragen + Flug-Updates; vier eigene Zustände (lädt / nichts / Fehler / Rückfrage) | §B letzter Punkt, Repo-Realität (kein IMAP) | Posteingang als Mail-Abholer | Existiert nicht im Produkt |
| E14 | Touren: eine Domänenfarbe, Verkehrsmittel als Icon | Owner-Entscheidung | Fünf Tourfarben | Überholt laut Handoff §2 |
| E15 | Kartenfarben: Variante 2 ist Standard (Owner 15.09.) — Domänenfarbe + Status-Merkmal (55 %, gestrichelt, hohler Endpunkt); gestrichelte Bögen als Renderer-Anforderung | §4 | Variante 1 (Statusfarbe) | Domänenfarbe ist im Produkt die Bedeutungsachse; Statusfarbe verwechselt Domäne und Zustand |
| E16 | Icons: nur Lucide-Sprite, 18 px Standard / 16 px in Zeilen / 14 px in Chips; Emoji nur als Nutzerwahl bei Ortslisten | §5 Icon-Familie | Emoji als Domänen-Icons | Zufällig, nicht skalierbar |
| E17 | Bewegung: 120/200/260 ms, `prefers-reduced-motion` nullt alles; Globus-Rotation 240 s stoppt bei Interaktion | §6, MOTION.md | Parallax/Glow überall | Akku, Lesbarkeit |

## 6 · Umsetzungsliste

**Weiterverwenden (vorhanden im Referenzbranch):** Statuspille, Tabelle, Domänen-Tabs, Karten-Layer, Setup/Login-Formulare, Einstellungs-Gruppen, Admin-Sektionen, Parser-Tabs, Achievement-Popup, Whats-New-Modal, ConfirmModal, CruiseEditModal, DomainImportPanel.

**Neue UI-Komponenten:** AppShell (4 Ziele + Mehr + Konto, mobil faltend) · ListRow (mobile Eintragszeile) · FilterChips mit aktiv/×/Zurücksetzen · DetailHeader (Kopfkarte + Kennzahlen-Streifen) · Collapsible MapPanel + MapBottomSheet (3 Höhen) · DialogShell (eine Shell, angedockt < 640) · SaveStatusLine · EmptyState/ErrorState/LoadingState mit getrennten Texten · StampGrid + EvidenceRow (Reisepass) · CommandSearch (⌘K) · TagChip · CompanionPicker · EffectsPreview (nur mit API) · ImportPreviewRow (Vertrauen) · PaperSheet (Druck).

**Benötigte Backend-Verträge (neu):**
- `GET /api/v1/review/:year` — Kennzahlenliste Jahresrückblick (Flüge, km, Tage, Länder neu/gesamt, Erfolge, ein Satz pro Domäne als Rohwerte, Top-Routen, Karte). Beschlossen, noch zu implementieren.
- `POST /api/v1/preview/effects` — Statistik-/Reisepass-/Erfolgs-Auswirkung vor Speichern/Löschen. Ohne Vertrag zeigt der Block „Auswirkung nicht ermittelbar“.
- `GET /api/v1/search?q=` — domänenübergreifende Suche (Flüge, Flughäfen, Kreuzfahrten, Unterkünfte, Orte, Reisen).
- Tags: `/api/v1/tags`, `/api/v1/:domain/:id/tags` — für Flug, Kreuzfahrt, Unterkunft, Ort (Owner). Companions analog mit `canonicalName`-Merge.
- `GET /api/v1/import/log` — Import-Logbuch (Datei, Provider, Dauer, Ergebnis, angelegte/verworfene Einträge).
- Reisepass: Zählschwelle persistieren (`settings.passport.threshold`); `GET /api/v1/passport/:cc/evidence` — Belege pro Land.
- Reisen: Gruppierungs-Vorschlag (Heuristik Buchungsnummer + Zeitraum) serverseitig.
- Dashboard: Modus ↔ URL-Vertrag (`/dashboard/:tab?mode=`) — heute laufen gemerkter Modus und URL auseinander (§C).
- Karte: geplante Bögen gestrichelt 6/6 — Renderer-Fähigkeit fehlt, **erforderlich** (Variante 2 beschlossen).
- Jahresrückblick: `GET /api/v1/review/:year/image` — serverseitiges PNG 1200 × 630 (beschlossen).
- Einstellungen: Router-Routen `/settings/:group` mit Sektionsankern (beschlossen).
- Checklisten: Abhaken legt Ort mit Datum an (`POST /api/v1/places/from-checklist`).
- Hotel-Import: Mehrfachbuchungen im selben Dokument als getrennte Aufenthalte mit je eigener Währung.
- Länderflaggen: `/api/v1/country-flags/:cc` (Platzhalter im Prototyp).
- Kopplung: Geräte-Endpoint (Beta `devicePairing`).

**Owner-Entscheidungen vom 15.09.2026 (umgesetzt):**
1. **Kartenfarben → Variante 2.** Domänenfarbe bleibt; Planungsstatus = 55 % Deckkraft + gestrichelt 6/6 + hohler Endpunkt. Gestrichelte Bögen sind Renderer-Anforderung für 2.7. Legende (Dashboard), Globus-Spezifikation und Karte-Voreinstellung „Domäne“ angepasst.
2. **Einstellungen als echte Routen in 2.7** (`/settings/account · /settings/flight · /settings/cruise · /settings/lodging` + Sektionsanker). Kopfzeile zeigt die Route; Seitenindex und Tabs sind die Routenfamilie.
3. **Erfolge unter Statistik.** Menüpunkt aus dem Profilmenü in „Mehr › Sammlungen“ neben Reisepass; Statistik-Kachel „Erfolge“ verlinkt; Erfolge-Seite mit Zurück zur Statistik. Profilmenü = Konto, Mitreisende, Einstellungen, Abmelden.
4. **Mitreisende + Tags für alle vier Domänen** nach identischem Muster (Tag-Chips in der Kopfkarte, Mitreisende-Block rechts mit Herkunft „eingetragen / aus Buchung“). Unterkunft- und Ort-Detail ergänzt. Backend-Vertrag: Tags/Companions je Domäne.
5. **Jahresrückblick teilen = serverseitiges PNG** (`GET /api/v1/review/:year/image`, 1200 × 630, Token-Farben). Druck/PDF bleibt für Archiv.

## 7 · Token-Abgleich

Verwendet werden ausschließlich Namen aus `tokens.json` (Referenz): `bg canvas surface surface2 tile border text textBright muted faint accent accentHover good warn bad info`, `domain.flight/cruise/hotel/poi`, `tier.bronze…diamond`, `chart[0..5]`, `paper paperText heroGradient`, Radien 12/14/16/26, Abstände 4er-Raster, Typo Hanken Grotesk / IBM Plex Mono / Newsreader (Ausnahme).

**Vorgeschlagene Ergänzungen (nicht stillschweigend geändert):**
| Token | Wert | Begründung | Companion |
|---|---|---|---|
| `motion.fast / base / enter` | 120 / 200 / 260 ms | Eine Zeitskala für Web und App | übernehmen (iOS 0,2–0,3 s passt) |
| `map.atmosphere` | `info` α .22 | Globus-Rand heute hart codiert | nur Web (3D) |
| `map.routeSelected` | `accentHover` + Glow α .35 | Auswahlzustand aus Token statt Konstante | Karte in App identisch |
| `focusRing` | `accent` α .18, 3 px | Tastaturfokus einheitlich | App: Systemfokus, kein Bedarf |
| `scrim` | `#040608` α .6 | Dialog/Sheet-Hintergrund | übernehmen |
| `ink60` (paper) | `paperText` α .62 | Sekundärtext auf Papier, Kontrast ≥ 7 : 1 | Druck aus App identisch |

Kontrastnachweis (D-06): muted `rgba(231,227,220,.6)` auf surface `#14181d` = 7,9 : 1; faint `.45` auf surface = 5,3 : 1 (nur ≥ 12 px, nie für Status); paperText auf paper 13,7 : 1; accent auf paper 2,6 : 1 → auf Papier kein Akzenttext, nur Tinte (umgesetzt in Druckansicht).

## Ablaufproben (§5) im Prototyp
- **A** Logbuch Fluege → Filter (Chips) → Flug Detail → Bearbeiten (Dialoge#flight) → Speichern (Toast, Rückgängig) · Fehlerfall: Feldzeile rot mit Ursache.
- **B** Hinzufuegen → E-Mail/PDF → Dialoge#import (Vertrauen, Duplikat, Hotel zuordnen/anderes, Währung) → Dialoge#trip → Posteingang (4 Zustände).
- **C** Dashboard Tab → Modus → Route → Seitenleiste/Sheet → Reise Detail → zurück.
- **D** Statistik → Reisepass v2 → Land aufklappen → Beleg → Flug/Unterkunft/Ort Detail.

---

# Runde 3 — Wunschliste §7

Stand 05.09.2026. 48 Screens. Einstieg `Index.dc.html`.

## Gebaut
- **§7.3 Schnellsuche ⌘K** — `Suche.dc.html`; Suchfeld in jeder Kopfleiste, `⌘K` / `/` öffnet. Gruppen Flüge · Flughäfen · Kreuzfahrten · Unterkünfte · Orte · Reisen · Seiten, Domänen-Icon + Pille, Scope-Chips. „Skagway“ → Hafentag.
- **§7.6 Tastatur** — global in `ts-shared.js` (`installKeys`): `g d/l/r/s`, `n`, `/`, `?` (Liste unter Suche › Tastatur). Regel: Tabellenzeile = ein Tabstopp, Aktionen im Detail.
- **§7.5 Import-Logbuch** — eigene Seite unter Werkzeuge; Datei, Quelle, Provider, Dauer, Ergebnis; aufklappbar angelegte Einträge, Verworfenes mit Grund, Quelldatei / Parse-Log / Erneut parsen.
- **§7.9 Mitreisende** — Verwaltungsseite (Profilmenü, Einstellungen › Konto): umbenennen, Schreibvarianten zusammenführen (`canonicalName`), gemeinsame Einträge „eingetragen“ vs. „aus Buchung“, Filter „mit Mia“. Nur Flug/Reise/Kreuzfahrt (Empfehlung 13).
- **§7.8 Tags** — Übersicht (Wolke, Filter, Vorschlag beim Tippen) und Chip-Regel: Hairline, klein, ohne Farbe; an Flug- und Kreuzfahrt-Detail.
- **§7.12 Kopplungs-Moment** — Geräte: Warten mit Timer → „iPhone 15 verbunden — 160 Flüge in 20 Sekunden auf dem Telefon“, Fortschritt, Store-Link.
- **§7.10 EN-Fassung** — Logbook · Passport · Settings als `lang="en"`; Kopfleiste, Menü, Statuspillen, Domänen ziehen EN aus `ts-shared.js`.
- **§7.4 Auswirkungen** — als Block in Bestätigen, Flug bearbeiten, Import-Vorschau (Runde 2); Komponente identisch mit „Hinzufügen“.

## Offen (Owner)
- Einstellungen als Routen pro Gruppe (11) — bereit zum Umbau, sobald entschieden.
- Mitreisende/Tags auf Unterkünfte und Orte (13).
- Rollen `row`/`cell`, Tablet-Stufe 768–1024 explizit, PNG-Export auf Zuruf.

---

# Runde 2 — Antwort auf die Rückmeldung vom 05.09.2026

Stand 05.09.2026, spät. Alle Punkte aus §8 in der geforderten Reihenfolge; Lieferform: 41 Screens (`*.dc.html`, offline lauffähig, alle verlinkt), `Index.dc.html` als Einstieg, Zustände per Wähler unten links (`#z=…`), Mobil live durch Verkleinern der Vorschau unter 640 px.

## Gebaut

### 1 · Korrekturen §2
- **2.1 Dashboard**: Tab-Leiste zurück (Alle · Flüge · Kreuzfahrten · Unterkünfte · Orte · Touren Beta), dieselbe Unterleiste wie Logbuch/Statistik. Karte-Panel zeigt nur die Modi des aktiven Tabs, je Domäne gemerkt; Adresse `/dashboard/<tab>?mode=` sichtbar. „Bereiche“ → „Sichtbarkeit“ (nur Zeichnen-Schalter, Tab „Alle“).
- **2.2 Domänenfarben**: Statistik-Serien Flüge/Kreuzfahrten tragen `domainColor`; `chartColors` nur für Serien ohne Domäne. Primitive zeigen Domänen-Serie, gemischte Serie und Diagramm bei 300 px.
- **2.3 Mono**: Detailwerte proportional; Mono nur für Codes, Kennungen, Messwerte, Zeitstempel (Schlüsselliste `MONO_KEYS` im Code).
- **2.4 Beta aus dem Register**: `BETA` in `ts-shared.js` spiegelt `betaFeatures.ts` (mit `why`/`returnsWhen` als Tooltip). Plaketten an Reisepass, Listen, Ort, KI-Zusammenfassung, Touren, Geräte, Dawarich. Parser ohne Plakette (Empfehlung 10).
- **2.5 Einzelstellen**: Statuspille aus `STATUS` im Logbuch; Flaggen als Kachel 18×13 (Endpunkt `/api/v1/country-flags/:cc`, CDN als Platzhalter); Demodaten zentral in `COUNTS`; Jahres-Chips ≤ 6, ältere im Dropdown; Journal-Tab im Reise-Detail; Kartenfarbe → zehn benannte `LIST_COLORS`; Excel-Export unter Meine Daten (kein Sync); Immich (Nutzer) + Dawarich (Beta) in Dienste; Prototyp-Fußzeile im Anmelden entfernt.
- **2.6 Kontrast**: `faint` nur dekorativ — alle lesbaren 10–13-px-Zeilen auf `muted` (24 Screens); Regel als Kachel in den Primitiven mit den gemessenen Werten.

### 2 · Mobil (§6) — Regel pro Primitiv, in `ts-shared.js`, auf alle Seiten angewandt
Kopfleiste faltet Primärziele in „Mehr“ (Gruppe „Ziele“), „Hinzufügen“ wird Icon · Chip-Zeilen scrollen mit Fade, nie umbrechen · Tabelle → ListRow (Logbuch) · Zweispalter stapelt · Hero-Aktionen → „…“ · Dashboard: Panels weg, Bottom-Sheet „Karte“ mit Reitern Modus/Ebenen/Legende/Sichtbar, Seitenleiste vollbreit · Dialoge docken unten an.

### 3 · Zustände (§4) — sechs Kernseiten
Leer · erstes Mal (Einladung statt leerem Globus) · Leer · Filter („Filter zurücksetzen“) · Laden (Skeleton in Kartenform, 8 × 64 px, Puls) · Fehler („—“ statt 0, Erneut versuchen / Neu anmelden) · Teilweise (Flug nur mit Datum, jedes „—“ mit Grund) · Beta aus (Touren, Orte, KI-Zusammenfassung, Geräte, Dawarich verschwinden).

### 4 · Dialoge (§5) — `Dialoge.dc.html`, eine Shell
Bestätigen (Danger nur hier, „was verschwindet / was bleibt“) · Flug bearbeiten (Duplikat-Hinweis, tatsächliche Zeiten, Vorschau der Auswirkungen) · Stops-Editor (drei Zustände, Reihenfolge, „Hafen auflösen“) · Import-Vorschau (Vertrauen pro Feld, Duplikat-Warnung, Reise) · Reise zuordnen · Was ist neu (Beta aus Register) · Errungenschaft freigeschaltet · Bild-Viewer · Toast mit Rückgängig. Verdrahtet aus Flug-Detail, Kreuzfahrt-Detail, Hinzufügen.

### 5 · Fehlende Seiten (§3)
Flugzeug · Liste (eigene) · Kuratierte Checkliste (Katalog-Semantik) · Touren-Editor (Vollbild, Stopps/Etappen/Routing/Tracks) · Admin › Stammdaten-Editor (Seed = Override, Benutzerdefiniert = löschbar). Dazu Statistik › Flüge mit 13 ausblendbaren Abschnitten (aus Runde 1 nachgezogen).

### 6 · Signaturmomente (§7.1, 7.2, 7.7)
Globus als Spezifikation (14 Festlegungen mit Token-Bezug, Hover-Karte, Zeitleiste abspielbar) · Jahresrückblick `/review/2026` (heroGradient, Newsreader-Satz, ein Satz pro Domäne, Karte, Erfolge, Vergleich, als Bild teilen) · Druckansicht A4 auf `paper` für Reisepass und Flug-Zertifikat.

### Zusätzlich (§7.11) Bewegung
Tokens `motion.fast/base/enter` in `tokens.json`; Keyframes in jedem Screen; Toggle, Chips, Tab-Unterstrich, Pillen, Panels, Menüs, Dialoge, Sheet, Toast, Stempel, Zähler, Balken, Globus. `prefers-reduced-motion` nullt alles. Doku `MOTION.md`.

## Offen (Runde 3 / Backlog)
- Einstellungen als Routen pro Gruppe (Empfehlung 11) — hier weiter eine Seite mit Sprungmarken; Umbau folgt der Owner-Entscheidung.
- §7.3 Schnellsuche ⌘K · §7.4 Auswirkungen beim Bearbeiten/Löschen sind in den Dialogen gezeigt, als Komponente noch nicht überall · §7.5 Import-Logbuch als Seite · §7.6 Tastatur-Regel · §7.8 Tag-Konzept · §7.9 Mitreisende als Verwaltungsseite · §7.10 EN-Fassung · §7.12 Kopplungs-Moment.
- Rollen `row`/`cell` an den Grid-Tabellen (Anhang A).
- PNG-Export 1440/390 pro Screen: die Screens rendern live in beiden Breiten; ein Bildexport ist auf Zuruf möglich.
- Tablet-Stufe 768–1024 nur implizit (Zweispalter brechen bei 960).

## Fragen an den Owner (unverändert §9, plus)
14. Dashboard-Tabs sind zurück — soll „Sichtbarkeit“ im Tab „Alle“ bleiben oder ganz in das Karte-Panel wandern?
15. Kuratierte Checklisten: Abhaken legt heute einen Ort mit heutigem Datum an — oder soll das Datum abgefragt werden?
16. Jahresrückblick als eigene Route `/review/:year` oder als Reiter in der Statistik?

---

# TravStats · Redesign mit modernem Ansatz — Struktur

## Navigation
Vier Primärziele in der Kopfleiste, alles andere im Menü „Mehr“; Konto-Dinge hinter dem Avatar.

- **Primär:** Dashboard · Logbuch · Reisen · Statistik
- **Mehr → Sammlungen:** Reisepass · Ortslisten
- **Mehr → Werkzeuge:** Posteingang · Parser (Beta) · Admin
- **Avatar (oben rechts):** Erfolge · Einstellungen · Abmelden
- Posteingang zusätzlich als Icon mit Ungelesen-Punkt neben „Mehr“; „Hinzufügen“ als einziger Primär-Button.

## E-Mail-Import (korrigiert, aus dem Repo)
- TravStats verbindet sich **nicht** mit einem Postfach. Der Nutzer gibt die Buchung: E-Mail-Datei, PDF, eingefügter Text oder Boarding-Pass-Foto — erster Weg im „Hinzufügen“-Dialog („Buchungs-E-Mail oder PDF · Wir lesen alles aus, du prüfst nur nach“), danach Vorschau und Speichern.
- Parser-Provider: LLM (Ollama/OpenAI/Claude) mit Regex-Fallback für Text, Tesseract OCR für Bilder; vom Admin konfiguriert.
- **Posteingang** = Datenqualitäts-Fragen („Zu prüfen“: Land widerspricht Adresse, Check-out vor Check-in, …; Antworten „Passt so“ / „Eintrag korrigieren“) + „Flug-Updates“ (API-Vorschläge: Anwenden / Bearbeiten / Ablehnen). Nichts wird ohne Entscheidung geändert.
- **Parser**-Seite = Annotieren (Template aus markierter Mail ableiten), Meine Templates, Community Templates (GitHub-Sync), Parse-Logs.

## Einstellungen: was wohin
Regel: Eine Option, die nur eine Ansicht betrifft, sitzt **an dieser Ansicht**. Alles Kontoweite liegt in *Einstellungen*.

**Kontextuell (nicht in Einstellungen):**
- Kartenlayer, Modus pro Bereich (Flüge: Routen/Flughafen-Frequenz/Trips · Kreuzfahrten: Seerouten/Itinerar/Hafen-Frequenz · Unterkünfte: Marker/Übernachtungen/Ketten), Färbung, Legende → klappbare Panels direkt auf der Karte; Seitenleiste (Aktivität/Flüge/Kreuzfahrten/Orte, „Nicht auf der Karte“) über „Aktivität“
- Spalten, Dichte, Sortierung → am Tabellenkopf im Logbuch
- Zeitraum / Vergleich → in der Statistik-Leiste
- Flug-Standards → Schalter im Logbuch-Formular (Vorbelegung), Definition in Einstellungen

**Einstellungen v3 · nach settings.json des Repos, in vier Tabs (Allgemein / Flug / Kreuzfahrt / Unterkünfte), links gruppierter Index:**
- Konto: Benutzer-Profil · Sicherheit (Passwort, 2FA, Passkeys) · Geräte (QR-Kopplung der App) · API-Tokens · Datenschutz (Datenauskunft, Konto löschen)
- Darstellung: Anzeige & Sprache · Einheiten & Formate · Bereichsfarben (Beta) · Funktionen (Kostenerfassung, Heckkennungen, Bereiche ein/aus) · Länderzählung (Durchreise / Aufenthalt / Übernachtung / Umsteigen — wie thresholdChoice im Repo)
- Daten: Meine Daten & Sync (nur Backup-Stand; Backups macht der Admin) · Listen importieren (FR24-CSV, generische CSV, Kreuzfahrt-Liste, GPX/KML; „Reisen automatisch anlegen“) · Automatische Updates (→ Posteingang) · Benachrichtigungen (E-Mail, braucht SMTP im Admin)
- Dienste: API-Schlüssel (eigener hat Vorrang vor Admin-Schlüssel) · Routing-Anbieter · Parser-Konfiguration (Vision/Text, Provider-Status) · Developer & Training
- Flug: Heimatflughafen · Standard-Werte · Bonusprogramme · Historische Anreicherung (365-Tage-Nachholen via AeroDataBox)
- Kreuzfahrt: Präferenzen (Kabinentyp, Route auf Karte) · Häfen als Orte
- Unterkünfte: Präferenzen (Basiswährung, Art) · Hotel-Bonusprogramme
- Kein Abo/„Pro“ (selbst gehostet), kein Sheets-Sync. Änderungen werden automatisch gespeichert (Statuszeile).

**Admin v2 · Bereiche wie im Repo:** Benutzer · Einladungen (Link / E-Mail) · System-Info (Version, Airline-Logos, Daten-Export, Wechselkurse) · Instanz (Name, URLs, Max. Benutzer, Registrierung, Beta-Funktionen mit Register-Liste, Länderzählung-Standard, Passkeys/WebAuthn) · Externe Dienste (globale API-Schlüssel, Immich, Geocoding) · Parser (globale Provider, Community-Templates, Feedback-Statistiken) · Training Config · Logging · Instanz-Backups (Zeitplan, WebDAV-Sync, Stände) · E-Mail/SMTP · Stammdaten (Airlines, Flugzeuge, Flughäfen, Schiffe, Häfen).

## Seiten
Registrieren · Passwort setzen/ändern · 404 · Kette Detail · Routeneditor · Bestenliste · Index (Übersicht aller Screens) · Anmelden (Passwort/Passkey, 2FA, Passwort vergessen) · Einrichtung (Admin-Konto → Instanz → fertig) · Hinzufügen (Flug / Kreuzfahrt / Unterkunft / Ort, ein Formular mit Domänenwahl, Parser-Einfügefeld, Vorschau der Auswirkungen) · Dashboard · Logbuch Flüge · Flug Detail (Zeiten plan/ist, Strecke, Buchung & Sitz, Kosten, Flugzeug, Datenquelle/Anreicherungs-Historie, Beleg, Duplizieren gleich/Rückflug) · Logbuch Domänen (Kreuzfahrten / Unterkünfte / Orte) · Unterkunft Detail (Haus mit mehreren Aufenthalten: Termine, Zimmer, Verpflegung, Bewertungen Zimmer/Frühstück/Service, Bonusprogramm aus der Kette, Ausgaben in Basiswährung) · Ort Detail (Besuche mit/ohne Datum, „War ich schon“/Merkliste, Listen, Stammdaten) · Kreuzfahrt Detail (Hafenfolge mit Tagen/Landausflügen, Kabine, Kosten pauschal, Flüge der Buchung, Mitreisende, Kartenfarbe, Notizen & Tags) · Reisen (Übersicht nach Jahr, Karten/Tabelle, Gruppierungs-Vorschlag) · Reise Detail (Tabs Übersicht · Timeline · Karte · Galerie · Logistik · Touren mit Stopps/Etappen/Routing/GPX-Dawarich-Tracks) · Statistik · Erfolge · Erfolg Detail (pro Erfolg: Regel, zählende Einträge, Reihe, Seltenheit) · Reisepass · Ortslisten · Posteingang · Parser · Admin v2 · Einstellungen v3 · Design Primitives.
Alle Seiten teilen Shell, Sprite und Nav-Modell aus `ts-shared.js`; Tokens in `design/tokens.json`.

## Offene Owner-Fragen
1. Ortslisten und Admin sind als eigene Seiten gebaut — Fortschritt der Listen wird aus besuchten Orten abgeleitet; korrekt so?
2. Developer Mode / LoRA-Training weiterhin als Beta-Schalter in den Nutzer-Einstellungen oder nur Admin?
3. Öffentliches Profil (Erfolge + Reisepass) gewünscht?
4. Nutzerfarben für Domänen behalten oder streichen (bricht Karten-Bedeutung)?
