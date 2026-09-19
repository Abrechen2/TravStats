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
