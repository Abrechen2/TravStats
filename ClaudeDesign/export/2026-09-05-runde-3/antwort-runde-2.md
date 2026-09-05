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
