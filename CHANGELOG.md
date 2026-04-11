# Changelog

All notable changes to TravStats are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

## [0.14.0-beta] - 2026-04-11

### Added
- **Hilfetexte auf allen Einstellungs- und Admin-Seiten** — 10 Komponenten
  (SmtpManager, ParserSettings, ApiKeys, Backup, Defaults, Features, Map,
  Notifications, Profile, Units) haben jetzt aufklappbare InlineHelp-Blöcke
  mit DE + EN Erklärungen zu Scope, Abhängigkeiten und Stolperfallen.
  Abdeckung jetzt 27 Komponenten mit 198 geprüften i18n-Keys.
- **Help-Audit-Skript** — `scripts/audit-inline-help.mjs` scannt alle
  InlineHelp- und HelpIcon-Elemente und verifiziert jeden `t()`-Key gegen
  DE und EN. Exit-Code 1 bei fehlenden Übersetzungen, nutzbar als CI-Gate.

### Fixed
- **Backup-Erstellung über die UI** — Der Route-Handler übergab vorberechnete
  Pfade via `existingRecord` an den Service, der aber intern einen neuen
  Timestamp generierte und deshalb `mkdirSync` auf einem anderen Ordner
  ausführte als er anschließend beschreiben wollte. Ergebnis: `pg_dump >
  .../temp/database.sql: Directory nonexistent`. Der Service übernimmt jetzt
  `backupDir`/`tempDir` direkt aus `existingRecord`.
- **"Datum unbekannt" in der Backup-Tabelle** — `serializeBigInt()` fiel
  bei Date-Objekten in den `typeof === 'object'`-Pfad und machte daraus `{}`,
  weil `Object.entries(date) === []`. Fix: Non-plain Objekte werden unverändert
  durchgereicht, Express ruft dann `Date.toJSON()` für die Wire-Serialisierung
  auf. +7 Regression-Tests.
- **Airline-Spalte konsistent** — Manche Flüge zeigten "Lufthansa", andere
  "LH". Eine neue `resolveAirlineDisplay()`-Funktion expandiert 2-Zeichen-
  IATA-Codes zum vollen Airline-Namen; überall angewendet (FlightsTablePage,
  FlightList, FlightCalendar, FlightSelectStep, YearHeatmap).
- **Trip-Filter-Chips** — Die Buttons zeigten rohe i18n-Keys `filter.with` /
  `filter.without`, weil im JSON `withTrip` / `withoutTrip` hinterlegt war.
  Keys in DE + EN an den Code angeglichen.
- **Fehlende Lib-Files committed** — `airlineUtils.ts` und `filterEmailText.ts`
  wurden von `FlightReviewModal` und `EmailAnnotation` importiert, existierten
  aber nur lokal (untracked). Ein frischer Clone hätte nicht gebaut.
- **Weiße Input-Felder auf Auth-Seiten** — LoginPage, ForceChangePasswordPage,
  ResetPasswordPage und AdminPasswordResetModal nutzten eine nicht existierende
  CSS-Klasse `.input-field` und fielen auf den Browser-Default (weiß) zurück.
  Umgestellt auf die existierende `.input`-Klasse.
- **"Hinweis"-Label im Developer Mode** — Der Key
  `settings:developer.help.noteLabel` fehlte in beiden Sprachen, sodass die UI
  beim Aufklappen den rohen i18n-Key gerendert hat. Ergänzt in DE + EN.

## [0.13.0-beta] - 2026-04-06

### Added
- **Password Reset per E-Mail** — Nutzer können über "Passwort vergessen?" auf der Login-Seite
  einen Reset-Link anfordern. Der Link wird per E-Mail zugestellt (nur wenn SMTP konfiguriert).
- **Admin-seitige Passwort-Zurücksetzung** — Admins können in der Benutzerverwaltung das
  Passwort eines Nutzers zurücksetzen: entweder ein zufälliges temporäres Passwort generieren
  (einmalig sichtbar, mit Kopierfunktion) oder ein eigenes Passwort direkt setzen. Optional
  kann "Muss Passwort beim nächsten Login ändern" aktiviert werden.
- **Erzwungener Passwort-Wechsel** — Wenn ein Admin das Flag setzt, muss der Nutzer beim
  nächsten Login ein neues Passwort festlegen, bevor er auf die App zugreifen kann.
- **Rate Limiting auf Reset-Endpunkten** — Passwort-Reset-Anfragen sind auf 5 Requests
  pro 15 Minuten begrenzt, um Missbrauch zu verhindern.

### Fixed
- **Route für erzwungenen Passwort-Wechsel** — Nach dem Login wurde fälschlicherweise
  `/force-change-password` statt `/change-password` aufgerufen; korrigiert.
- **Unique-Constraint auf Token-Feldern** — Reset- und Change-Token erhalten einen
  Datenbank-Unique-Index, der Single-Use-Semantik auf DB-Ebene erzwingt.

## [0.12.2-beta] - 2026-04-06

### Security
- **nginx-Versionsleak behoben** — `server_tokens off` in der nginx-Konfiguration verhindert die Offenlegung der nginx-Version in Response-Headern.
- **Doppelte Security-Header entfernt** — nginx setzt keine Security-Header mehr; Helmet übernimmt sie vollständig und vermeidet Konflikte bei X-XSS-Protection, Referrer-Policy und HSTS.
- **XSS-Sanitierung in Flight-Notes** — HTML-Tags werden im Backend aus dem `notes`-Feld herausgefiltert bevor sie gespeichert werden.

### Fixed
- **Express-404-Seiten** — Nicht gefundene Routen geben jetzt `{"error":"Not found"}` statt der internen Express-HTML-Seite zurück.
- **JSON-Parse-Fehler anonymisiert** — Ungültiger JSON-Body gibt jetzt eine generische Fehlermeldung zurück statt des internen Parser-Fehlertexts.

## [0.12.1-beta] - 2026-04-06

### Security
- **CORS verschärft** — CORS-Wildcard gilt jetzt nur noch im Development-Modus (`NODE_ENV === development`), nicht mehr in allen Nicht-Production-Umgebungen.
- **Rate-Limiting ergänzt** — Upload-Endpoint (30/Std.) und alle Settings-Routen (60/15min) haben jetzt Rate-Limiting gegen Disk-Exhaustion und Enumeration.
- **Passwort-Mindestlänge erhöht** — Mindestlänge von 6 auf 8 Zeichen angehoben.

### Fixed
- **Datenbank-Startfehler sofort erkennbar** — Fehlende DB-Konfiguration bricht den Server-Start jetzt ab statt nur zu warnen.
- **Globale Error-Handler** — Unhandled Promise Rejections und uncaught Exceptions aus Schedulern werden jetzt geloggt statt den Server lautlos zum Absturz zu bringen.
- **Parser-Settings-Endpoint korrigiert** — PUT `/api/v1/settings/parser` gab fälschlicherweise 200 OK zurück ohne etwas zu speichern; gibt jetzt korrekt 501 Not Implemented zurück.
- **Query-Parameter-Validierung** — `parseInt()` in Admin-Parse-Log-Routen durch Zod-Schemas ersetzt (verhindert NaN in DB-Queries).
- **Trip-Listen-Query begrenzt** — GET `/trips` lädt jetzt maximal 500 Trips + 200 Flights pro Trip (war: unbegrenzt).
- **ErrorBoundary-Logging** — `console.error` im ErrorBoundary ist jetzt auf Development-Mode beschränkt.
- **package.json versioniert** — `backend/package.json` und `frontend/package.json` auf `0.12.1-beta` synchronisiert.

## [0.12.0-beta] - 2026-04-06

### Added
- **Leere Karten-Ansicht** — Neue Nutzer sehen jetzt eine Hinweiskarte mit
  direktem „Flug hinzufügen"-Button statt eines leeren Globus.
- **ICAO-Code im Flughafen-Tooltip** — Der Klick auf ein Flughafen-Label
  zeigt nun zusätzlich den ICAO-Code als Badge neben dem IATA-Code an.
- **Gate, Terminal, Boarding-Gruppe & Begleiter im Edit-Modal** — Diese
  vier Felder sind jetzt vollständig im Flug-Bearbeitungs-Dialog editierbar.

### Fixed
- **Sprachunterstützung** — Hardcodierte deutsche Texte in Karten-Tooltip,
  Trips-Tab und Flug-Zähler durch i18n-Keys ersetzt; tote ContextualHint-
  Referenz entfernt. Alle Texte reagieren jetzt korrekt auf die Spracheinstellung.
- **Flug-Umlaut-Fehler** — „¨e" (Prettier-Bug) im Plural „Flüge" behoben.
- **Highlight-Modus verlassen** — Klick auf leere Kartenfläche beendet
  Trip- oder Flug-Highlight zuverlässig.

### Changed
- **Tooltip-Performance** — `onMove`-Handler per requestAnimationFrame
  gedrosselt; Tooltip-Neuberechnung läuft maximal einmal pro Frame statt
  bis zu 60× pro Sekunde.
- **Code-Qualität** — Plane- und Puls-Animation aus DeckGLMap in eigene
  Hooks extrahiert (DeckGLMap: 582 → 430 Zeilen); TooltipContainer und
  formatDuration als gemeinsame Primitive bereitgestellt.

## [0.11.0-beta] - 2026-04-06

### Added
- **Trips-Tab in der Seitenleiste** — Schnellauswahl aller gespeicherten Trips direkt
  aus dem Flug-Panel heraus, inklusive Fluganzahl, Jahr und Gesamtkilometer.
- **TripTooltip auf der Karte** — Beim Auswählen eines Trips erscheint eine Info-Karte
  mit Routenkette, Reisedaten, Gesamtdauer, Distanz, Airlines und Flugzeugtypen.
- **Airport-Statistik-Tooltip** — Klick auf einen IATA-Code oder Airport-Punkt öffnet
  eine Statistik-Karte mit Abflügen/Ankünften, häufigsten Routen, Gesamtkilometern
  und operierenden Airlines für diesen Flughafen.
- **Auto-Highlight beim „Auf Karte zeigen"** — Alle Flüge eines Trips werden automatisch
  ausgewählt, sobald über „Auf Karte zeigen" in die Trip-Routen-Ansicht gewechselt wird.
- **Flughafen-Marker im Trip-Routen-Layer** — Gepulste Ringe und Beschriftungen für
  alle Abflug- und Zielflughäfen des aktiven Trips.
- **5 Demo-Trips** — Seed-Daten für neue Nutzer enthalten jetzt fünf vordefinierte Trips
  (Barcelona, Dubai & Singapur, Japan, Skandinavien, USA Westküste).

### Fixed
- **Tooltips folgen der Karte** — Alle Info-Fenster (Flug, Trip, Flughafen) aktualisieren
  ihre Position beim Scrollen und Zoomen über geo-verankerte Projektion.
- **Trip-Info-Karte über den Bögen** — Tooltip wird oberhalb der Bounding Box aller
  Airports positioniert, damit er nicht über den Routenlinien liegt.
- **Seitenleiste bleibt offen** — Beim Auswählen eines Trips im Seitenleisten-Panel
  schließt sich dieses nicht mehr automatisch.
- **Zurück zur Normalansicht** — Schließen des Trip-Tooltips setzt visMode auf „routes"
  zurück und hebt die Trip-Auswahl auf.
- **Arc-Klick-Toleranz** — `pickingRadius: 5` auf dem MapboxOverlay behebt das Problem,
  dass Klicks auf schmale Bögen nicht registriert wurden.
- **Deck.gl Layer-Neurendering** — Farben werden vorberechnet in den Daten gespeichert,
  damit deck.gl bei Selektion zuverlässig neu zeichnet.
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

---

## [0.10.0-beta] - 2026-04-05 (Update 2)

### Added
- **`operatingAirline` Feld**: Neues optionales DB-Feld `operating_airline` (Migration `20260405000000_add_operating_airline`). Speichert den durchführenden Carrier bei Codeshare-Flügen sowie Bahn/Bus-Tickets.
- **"Durchgeführt von"-Formularfeld**: In `FlightEditModal` und `FlightCompleteStep` mit `<datalist>`-Autovervollständigung.
- **Airline-Autovervollständigung**: Alle Airline-Felder haben jetzt browser-native `<datalist>` mit ~75 Airlines inkl. Bahn/Bus-Betreiber (DB, FlixTrain, Flixbus, ÖBB, SBB, TGV, Eurostar).
- **`cleanEmailBody()` Utility**: Bereinigt plain-text E-Mail-Body vor dem Parsen — entfernt HTML-Tags, URLs, normalisiert Whitespace. Spiegelt die `filterEmailText`-Funktion der Annotation-Ansicht.

### Changed
- **Parser nutzt bereinigten Text**: `parseEmail()` wendet `cleanEmailBody()` an bevor Text an alle Parser übergeben wird — Parser und Annotation-Ansicht sehen jetzt identischen Text.
- **`EmailAnnotation` speichert gefilterten Text**: `fullText` in Annotations wird als `filterEmailText(raw)` gespeichert statt roh — Annotation-Positionen und Pattern-Ableitungen sind konsistent.
- **Airline auto-ableiten**: Post-Processing leitet Airline-Name aus Flugnummer-Prefix ab (`LH2316` → `LH` → `"Lufthansa"`) wenn `airline` leer.
- **Parser erkennt `operated by`**: `"operated by X"` / `"durchgeführt von X"` Muster werden automatisch als `operatingAirline` erfasst.
- **`AIRLINE_IATA_MAP`** von 15 auf ~75 Airlines erweitert.

### Fixed
- **400-Fehler beim Hinzufügen**: Zod-Schema warf Fehler wenn `airline: ""` (Leerstring) übergeben wurde. Fix: `emptyStringToUndefined` Transform für `airline` und `flightNumber` in `baseFlightSchema`.
- **LH-old Template**: `flightNumber`-Pattern auf `^([A-Z]{2}\s+\d{3,4})$` geändert — funktioniert nach `cleanEmailBody()` da `<img.png>\tLH 2316\t` → `LH 2316` (eigene Zeile). Template-Version auf `2025-04b` gebumpt und zu GitHub-Templates-Repo gepusht.

---

## [0.10.0-beta] - 2026-04-04

### Added
- **Enrichment two-mode system**: flights < 1 year → Full enrichment (aircraft, ICAO codes, route, terminal, gate); flights ≥ 1 year → Slim enrichment (ICAO codes + terminal only).
- **`getEnrichmentMode()`**: Exported helper that determines enrichment mode from flight age.
- **Route median interpolation**: `aggregateRoutes` now resamples all reference routes to 20 points and computes per-position median lat/lon — replaces "take newest route" approach.
- **Enrichment badge in PendingUpdateCard**: Full (green) / Slim (amber) badge + "Vorschlag · nicht verifiziert" disclaimer with reference flight count and confidence score.
- **Two-mode explanation panel** in Settings → Enrichment tab.

### Changed
- **`findEnrichmentCandidates`**: Now excludes flights with `pending` or `rejected` pending updates (previously only `applied` was excluded — caused infinite nightly re-processing).
- **Settings simplified**: `requireApproval` and `autoProcess` removed — enrichments always create a pending update requiring manual confirmation. Settings reduced from 6 to 3 fields (`enabled`, `minConfidence`, `maxPerDay`).
- **Scheduler**: Runs for all users with `historicalEnrichmentEnabled=true` (no longer gated on `autoProcess`).

### Removed
- **`historicalEnrichmentMaxAgeYears`**, **`historicalEnrichmentAutoProcess`**, **`historicalEnrichmentRequireApproval`** from `UserSettings` schema and DB.

---

## [0.9.6-beta] - 2026-04-03

### Added
- **Ollama config in Admin UI**: `ollamaUrl`, `ollamaModel`, `ollamaVisionModel` stored in `AdminSettings` DB table; editable in Admin → Parser Settings.
- **Backup schedule in Admin UI**: `backupEnabled`, `backupInterval`, `backupRetentionDays` stored in `AdminSettings`; editable in Admin → Backup Management.
- **`dateUtils.ts`**: Timezone-aware date/time formatting with `Intl.DateTimeFormat`; graceful UTC fallback for invalid timezone strings.
- **Timezone-aware flights table**: `FlightsTablePage` now formats dates using the user's configured timezone from settings store.

### Changed
- **`getParserConfig()`**: Reads `ollamaUrl/Model/VisionModel` from `adminSettings` parameter with ENV fallback.
- **`backupScheduler.ts`**: `getBackupSettings()` reads backup config from DB instead of ENV; runtime validation via `VALID_INTERVALS`/`toBackupInterval()`.
- **`BackupSection`** (Settings): Now a read-only status view; backup schedule configuration moved to Admin → Backup Management.
- **`NotificationsSection`** (Settings): Removed dead toggles; renders only `NotificationPreferences`.

### Removed
- **`debugLoggingEnabled`** + **`requireUserApiKeys`** from `AdminSettings` schema — log level from ENV, API keys always required.
- **`trainingSeparateModels`** from `UserSettings` schema.
- **`SystemSettings`** model dropped entirely.
- **Ghost backup/notification fields** from `settingsStore`, `useSettingsPage`, API types.

---

## [0.9.5-beta] - 2026-04-03

### Removed
- **LLM Training dead code**: Deleted orphaned `TrainingDashboard`, `TrainingDataFilters`, `TrainingDataPreview` components (never imported after TrainingPage → ParserPage refactor).
- **Save + Train button**: Removed LoRA fine-tuning trigger from `EmailAnnotation` and `BoardingPassAnnotation` — annotation now always derives templates via `annotate` endpoint only.
- **Dead `trainingApi` methods**: `saveAndTrain`, `trainOnly`, `getData`, `getJobs`, `getJobLogs`, `triggerTraining`, `cancelTraining`, `deleteTrainingData` removed from frontend API client.
- **Dead TypeScript types**: `TrainingJob`, `TrainingJobLog`, `TrainingJobLogsResponse` removed from `types/index.ts`.
- **LLM-only backend endpoints**: `POST /:id/save-and-train`, `POST /:id/train-only`, `GET /data`, `GET /jobs`, `GET /jobs/:id/logs`, `DELETE /:id`, `POST /trigger`, `POST /jobs/:id/cancel`, `GET /data/analysis` removed from training route.

---

## [0.9.3-beta] - 2026-04-03

### Added
- **Annotation-Driven Template Parser**: Users can annotate parsed email fields to derive regex-based templates. Annotated patterns are stored as `ParserTemplate` records and applied as step 0 in the parser factory for future emails from the same airline.
- **TemplateDeriver**: Derives multi-flight regex templates from user annotations (`textSelections`) with field source tracking (`fieldSources`).
- **FingerprintMatcher**: Matches incoming emails to existing user templates by airline/subject fingerprint.
- **UserTemplateEngine**: Executes derived templates against email bodies with multi-flight extraction.
- **Parser Templates CRUD API**: `GET/POST/DELETE /api/v1/parser-templates` — list, activate, disable, delete user-derived templates.
- **TemplateReviewCard**: UI card shown after annotation save to display the newly derived template with confidence score.
- **Colour-coded confidence borders** in `FlightReviewModal`: green (template match), yellow (LLM fallback).
- **`fieldSources`** on `ParsedBooking` — tracks which field was extracted by which method.

### Fixed
- Regex PNR `matchAll` missing `g` flag — caused 500 error during email parsing.
- `GET /api/v1/parser-templates/:id` endpoint added (was missing).
- Body length guard against ReDoS attacks in parser template routes.
- `TemplateReviewCard` async error handling and loading states.

---

## [0.9.2-beta] - 2026-04-02

### Changed
- **Map amber redesign**: Glassmorphism theme now uses TravStats brand colors (amber→orange→red) throughout all visualization modes. Replaces previous indigo/cyan color scheme.
- **Filter as FAB**: Filter button relocated from bottom-center bar to bottom-right FAB stack (frosted-glass style, opens panel upward). Mode FAB stacked above filter.
- **CSS tokens**: `--map-accent`, `--map-fab-gradient`, `--map-active-*`, `--map-badge-*` all updated to amber. Sepia CSS filter on map canvas removed. Dark-matter map style restored unconditionally.

### Added
- **Globe night earth**: Night-earth texture (`earth-night.jpg`) with amber atmosphere glow + starfield background (`night-sky.png`) in Globe mode.
- **Globe legend stacking**: Auto-rotation toggle and route-frequency legend share bottom-left column (no overlap).

### Fixed
- Airport labels (`TextLayer`) now always render above arc lines (`depthCompare: "always"`).

---

## [0.9.1-beta] - 2026-03-31

### Added
- **Email Import as primary tab**: Email import promoted to main "Import" tab in the UI. `EmailImportTab` component with drag & drop, airline notice, and text fallback.
- **Template Status View**: Settings page shows GitHub-linked template status. New `TemplateStatusView` component + `/api/v1/templates/status` endpoint.
- **Duplicate Flight Detection**: POST `/api/v1/flights` returns 409 with `existingFlight` details when duplicate detected. Frontend shows confirmation dialog with "Add Anyway" option (`?force=true` bypass).
- **Year-over-Year Statistics**: `/api/v1/stats/summary?year=YYYY&compareYear=YYYY` with delta badges (↑↓ % change).
- **Travel Companions**: `companions` field on Flight model. Tag-style input in `SimplifiedFlightFormV2`.
- **Seat Statistics**: `GET /api/v1/stats/seats` — distribution by position, zone, and cabin class.
- **Flight Certificate**: `FlightCertificate.tsx` generates downloadable PNG stats card via html2canvas.
- **Email Notifications**: SMTP config, per-user notification preferences, node-cron reminder scheduler.
- `statsLimiter` (30 req/min) and `adminExportLimiter` (5/hr) rate limiters.

### Changed
- **deck.gl visualization**: 6 map modes — Routes, Heatmap, Hexagon (3D), 3D Columns, Trips (animated), Globe (react-globe.gl)
- `VisModeSelector`, `TimeSlider`, layer factories for all visualization modes
- Map integration refactored from Leaflet to deck.gl 9.x + MapLibre GL 5.x
- `flightNumber` now included in `calculateChanges` comparison fields (was silently ignored before)

### Fixed
- Fresh-DB migration ordering: early migrations (`202501xx`) wrapped in `IF EXISTS` guards; catch-up migration (`20251221`) recovers all columns
- Backend CI: ESLint added as explicit dependency, ESLint 9 rule violations resolved
- All 156 backend tests now pass (assertions aligned with actual service/route return types)
- GeoJSON layer factories now read from `geometry.coordinates`, not unpopulated airport `lat`/`lon` fields

---

## [0.9.0-beta] - 2026-02-24

First public beta release. Re-versioned from 1.0.x to 0.9.0-beta to reflect that not all planned features are complete yet.

### Added
- Version badge in About tab (reads from package.json)
- Rate limiting on backup-restore (3/hr) and training-trigger (2/hr) endpoints
- Zod validation for stats route query parameters
- PayPal donation and GitHub Star buttons in Settings → About
- i18n translations for all hardcoded strings in `SimplifiedFlightForm`
- Missing `unknownDate` i18n key in dashboard translations
- i18n translations for hardcoded strings in `DashboardPage` (PDF export, map/stats fallbacks)

### Changed
- Package versions bumped to `0.9.0-beta` (frontend + backend)
- Admin page refactored to sidebar layout
- All plain browser checkboxes replaced with styled `.checkbox` class

### Fixed
- `alert()` calls in AchievementsPage replaced with toast notifications
- `console.debug()` calls in `barcodeExtractor.ts` replaced with `logger.debug()`
- Dark mode issues across all pages (hardcoded Tailwind colors → CSS variables)

---

## [1.0.1] - 2026-02-23

### Added
- Prettier formatter for frontend TypeScript/TSX/CSS (`format` and `format:check` scripts)
- ts-prune dead code detection scripts in frontend and backend (`dead-code` script)
- Vitest coverage reporting with v8 provider and regression thresholds (`test:coverage` script)
- ruff.toml Python linter config; auto-fixed 220 issues in training scripts
- bandit security config (`.bandit.yml`) for Python script scanning
- License whitelist (`LICENSE_WHITELIST.txt`) covering all project dependencies
- Pre-commit hooks: trailing whitespace, YAML/JSON validation, secret detection, ruff, Prettier
- GitHub Actions CI workflow: backend (typecheck + lint + test with Postgres), frontend (typecheck + lint + format + coverage), Python (ruff + bandit)
- Dev setup scripts (`scripts/setup-dev.sh` and `scripts/setup-dev.ps1`) for onboarding
- Smoke test script (`scripts/smoke-test.sh`) for post-deploy verification

### Changed
- Docker security hardening: `cap_drop: ALL` + minimal `cap_add`, `no-new-privileges`, log rotation, and resource limits on `app`, `db`, and `ollama` services

### Fixed
- Removed unnecessary `CAP_SETUID`/`CAP_SETGID` from app container (root can setuid without them)
- Corrected pre-commit prettier hook entry to properly forward filenames (`npx --prefix frontend prettier --write`)
- Removed dead coverage config block from `vite.config.ts` (shadowed by `vitest.config.ts`)

## [1.0.0] - 2026-02-23

### Added
- Initial stable release
- Flight tracking with map visualization (Leaflet, 3D Globe)
- Statistics dashboard (distance, time, routes, heatmaps)
- Achievements & Gamification system (20+ badges)
- Boarding pass scanner (QR/Barcode + OCR via Tesseract.js)
- Email booking import (manual upload + IMAP polling)
- Flight data lookup (AirLabs API integration)
- OpenFlights airport database (~14.000 airports)
- Export: CSV, GeoJSON, KML
- Tags & Categories (business/private)
- Cost tracking per flight
- Dark/Light mode
- Multi-language support (DE/EN)
- LLM-powered parsing (Ollama integration)
- LoRA fine-tuning pipeline for email/boarding-pass models
- Pre-training data quality analysis (checkTrainingData.py)
- Post-training model evaluation (evalModel.py)
- Training metrics parsing (loss, steps, epochs)
- Docker deployment with nginx + supervisor
- JWT authentication with secure cookie handling
