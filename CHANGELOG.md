# Changelog

All notable changes to TravStats are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

## [0.15.1-beta] - 2026-04-11

### Fixed
- **Copy-to-clipboard on insecure HTTP origins** — Every "Copy link"
  button in the admin area silently did nothing when TravStats was
  accessed over plain HTTP on a LAN IP (the typical deployment), because
  `navigator.clipboard.writeText` is only available in a secure context
  (HTTPS or `localhost`). A new shared `copyToClipboard` utility tries
  the modern API first and falls back to a hidden-textarea plus
  `document.execCommand("copy")` path when the modern API is
  unavailable or rejects. The fix is wired into the invitation success
  modal, the row-level copy action in the invitation list, and the
  admin temporary-password reveal. Verified locally by running the dev
  server on a LAN IP (`window.isSecureContext === false`,
  `navigator.clipboard === undefined`) — both copy buttons now surface
  the success toast and actually write to the clipboard.

## [0.15.0-beta] - 2026-04-11

### Added
- **Invitation system v2** — The admin invitation surface is rebuilt
  end-to-end. Two distinct entry points replace the browser `prompt()`:
  a "Create link" modal that generates a shareable URL with an
  expiration radio (24h / 7d / 30d), and a "Create by email" modal
  that additionally sends the invitation through SMTP to a given
  recipient. The success modal keeps the link visible with a copy
  button until the admin dismisses it, so the URL is never "lost in
  a toast" again. On SMTP failure the invitation is still created
  and the modal shows an amber warning with the concrete error and
  the fallback link.
- **Row-level invitation management** — Every invitation row in the
  admin list now has context-aware actions: re-copy the link on any
  active invitation, resend the email (only for rows with an email
  attached and a null/failed send status), and revoke (hard-delete)
  any non-used invitation. A filter chip row above the table
  (`Alle` / `Aktiv` / `Verwendet` / `Abgelaufen`) narrows the view,
  and a new "Verwendet von" column shows which user consumed each
  used invitation.
- **`MAX_USERS` enforcement at invitation create time** — Both
  create endpoints now run a serializable transaction that counts
  `users + active invitations` and rejects with `409 User limit
  reached` before any row is inserted. `MAX_USERS` was previously
  only a warning log that never actually blocked anything.
- **Auto-populated `notificationEmail` on invited registrations** —
  When a user registers through an invitation that carried an email
  address, that address is copied into the new user's
  `notificationEmail` field during the same insert. Password reset
  works for invited users out of the box without a manual visit to
  the settings page.
- **Email delivery tracking per invitation** — The `invitations`
  table gets three new columns (`email_status`, `email_error`,
  `email_sent_at`) so the list row can show the last send outcome
  and the resend action can target failed deliveries specifically.
  The `used_by` foreign key is tightened to `ON DELETE SET NULL`
  so deleting a user no longer cascades to historical invitation
  rows.
- **Dedicated `sendInvitationEmail` helper** — A new function in
  `emailService.ts` mirrors the existing `sendPasswordResetEmail`
  pattern but throws on SMTP misconfiguration instead of silently
  returning. The route handler catches the throw, marks the
  invitation `email_status='failed'` with the underlying error
  text, and still returns 200 — the *invitation* create succeeded
  even when the *email send* did not.

## [0.14.1-beta] - 2026-04-11

### Fixed
- **Invitation system wired end-to-end** — The register flow never
  forwarded the invitation token to the backend, so invited users
  silently registered as normal uninvited users and the invitation
  record stayed forever "active" in the admin list. `authApi.register`
  now accepts a third `invitationToken` argument, `RegisterPage` reads
  the `?token=` query parameter via `useSearchParams`, and a green
  "you are registering with an invitation" banner confirms that the
  link was picked up. Companion prod-config change: `FRONTEND_URL=
  http://192.168.178.120:3010` and `ALLOW_REGISTRATION=false` added to
  the CT 100 docker-compose.yml so invite URLs no longer point to
  localhost and public registration is actually gated on a valid
  invite. Verified end-to-end against a local dev instance: registration
  without a token is blocked, an admin-created invite flows through
  the register page, the `invitedBy` column is populated, and a second
  use of the same token is rejected by the database unique constraint.

## [0.14.0-beta] - 2026-04-11

### Added
- **Help texts on every settings and admin surface** — 10 components
  (SmtpManager, ParserSettings, ApiKeys, Backup, Defaults, Features, Map,
  Notifications, Profile, Units) now ship expandable InlineHelp blocks with
  DE + EN explanations covering scope, dependencies and gotchas. Coverage
  is now 27 components with 198 checked i18n keys.
- **Help audit script** — `scripts/audit-inline-help.mjs` walks every
  InlineHelp and HelpIcon element and verifies each `t()` key against DE
  and EN. Exits non-zero on missing translations; usable as a CI gate.

### Fixed
- **Backup creation via the UI** — The route handler passed pre-computed
  paths to the service through `existingRecord`, but the service generated
  a fresh timestamp internally and therefore ran `mkdirSync` on a different
  directory than it tried to write to. Result: `pg_dump >
  .../temp/database.sql: Directory nonexistent`. The service now takes
  `backupDir`/`tempDir` directly from `existingRecord`.
- **"Date unknown" in the backup table** — `serializeBigInt()` fell into
  the `typeof === 'object'` branch for Date objects and turned them into
  `{}` because `Object.entries(date) === []`. Fix: non-plain objects are
  passed through unchanged so Express can call `Date.toJSON()` for wire
  serialization. +7 regression tests.
- **Consistent airline column** — Some flights showed "Lufthansa", others
  just "LH". A new `resolveAirlineDisplay()` helper expands 2-char IATA
  codes to the full airline name; applied everywhere (FlightsTablePage,
  FlightList, FlightCalendar, FlightSelectStep, YearHeatmap).
- **Trip filter chips** — The buttons rendered the raw i18n keys
  `filter.with` / `filter.without` because the JSON held `withTrip` /
  `withoutTrip`. Keys renamed in both DE and EN to match the code.
- **Missing lib files committed** — `airlineUtils.ts` and
  `filterEmailText.ts` were imported by `FlightReviewModal` and
  `EmailAnnotation` but only existed locally (untracked). A clean clone
  would have failed to build.
- **White input fields on auth pages** — LoginPage, ForceChangePasswordPage,
  ResetPasswordPage and AdminPasswordResetModal referenced a CSS class
  `.input-field` that does not exist anywhere, so the inputs fell back to
  the browser default (white). Switched to the existing `.input` class.
- **"Note" label in developer mode help** — The key
  `settings:developer.help.noteLabel` was missing in both languages, so
  the UI rendered the raw i18n key when the help was expanded. Added in
  DE + EN.

## [0.13.0-beta] - 2026-04-06

### Added
- **Email-based password reset** — Users can request a reset link from
  the login page via "Forgot password?". The link is delivered by email
  (only when SMTP is configured).
- **Admin password reset** — Admins can reset a user's password from
  user management: either generate a random temporary password (shown
  once, with a copy button) or set a password directly. Optionally, a
  "Must change password on next login" flag can be enabled.
- **Forced password change** — When the admin sets the flag, the user
  must choose a new password on the next login before they can access
  the app.
- **Rate limiting on reset endpoints** — Password reset requests are
  limited to 5 requests per 15 minutes to prevent abuse.

### Fixed
- **Force-change-password route** — After login the frontend incorrectly
  called `/force-change-password` instead of `/change-password`; fixed.
- **Unique constraint on token fields** — Reset and change tokens now
  have a database unique index that enforces single-use semantics at
  the DB level.

## [0.12.2-beta] - 2026-04-06

### Security
- **nginx version leak fixed** — `server_tokens off` in the nginx config
  prevents exposure of the nginx version in response headers.
- **Duplicate security headers removed** — nginx no longer sets security
  headers; Helmet owns them completely, avoiding conflicts on
  X-XSS-Protection, Referrer-Policy and HSTS.
- **XSS sanitization in flight notes** — HTML tags are stripped from the
  backend `notes` field before being stored.

### Fixed
- **Express 404 pages** — Missing routes now return `{"error":"Not
  found"}` instead of the internal Express HTML page.
- **JSON parse errors anonymized** — Invalid JSON bodies now return a
  generic error message instead of the internal parser error text.

## [0.12.1-beta] - 2026-04-06

### Security
- **CORS tightened** — The CORS wildcard now only applies in development
  mode (`NODE_ENV === development`), not in all non-production
  environments.
- **Additional rate limiting** — Upload endpoint (30/hr) and every
  settings route (60/15min) now have rate limits guarding against disk
  exhaustion and enumeration.
- **Minimum password length raised** — Minimum length raised from 6 to
  8 characters.

### Fixed
- **Database start failures surfaced immediately** — Missing DB
  configuration now aborts server startup instead of just warning.
- **Global error handlers** — Unhandled promise rejections and uncaught
  exceptions from schedulers are now logged instead of silently crashing
  the server.
- **Parser settings endpoint corrected** — PUT `/api/v1/settings/parser`
  incorrectly returned 200 OK without saving anything; now correctly
  returns 501 Not Implemented.
- **Query parameter validation** — `parseInt()` in admin parse-log
  routes replaced with Zod schemas (prevents NaN reaching DB queries).
- **Trip list query bounded** — GET `/trips` now loads at most 500 trips
  + 200 flights per trip (was: unbounded).
- **ErrorBoundary logging** — `console.error` in ErrorBoundary is now
  scoped to development mode.
- **package.json versioned** — `backend/package.json` and
  `frontend/package.json` synchronized to `0.12.1-beta`.

## [0.12.0-beta] - 2026-04-06

### Added
- **Empty map view** — New users now see a hint card with a direct
  "Add flight" button instead of an empty globe.
- **ICAO code in the airport tooltip** — Clicking an airport label now
  additionally shows the ICAO code as a badge next to the IATA code.
- **Gate, terminal, boarding group and companions in the edit modal**
  — These four fields are now fully editable in the flight edit dialog.

### Fixed
- **Language support** — Hardcoded German strings in the map tooltip,
  trips tab and flight counter replaced with i18n keys; dead
  ContextualHint reference removed. All text now reacts correctly to
  the language setting.
- **Umlaut bug** — `¨e` (a Prettier artifact) in the plural "Flüge"
  fixed.
- **Exit highlight mode** — Clicking on empty map space now reliably
  ends trip or flight highlight.

### Changed
- **Tooltip performance** — `onMove` handler throttled via
  requestAnimationFrame; tooltip recalculation runs at most once per
  frame instead of up to 60 times per second.
- **Code quality** — Plane and pulse animations extracted from
  DeckGLMap into dedicated hooks (DeckGLMap: 582 → 430 lines);
  TooltipContainer and formatDuration provided as shared primitives.

## [0.11.0-beta] - 2026-04-06

### Added
- **Trips tab in the sidebar** — Quick selection of all saved trips
  directly from the flight panel, including flight count, year and
  total kilometers.
- **TripTooltip on the map** — Selecting a trip now shows an info card
  with the route chain, travel dates, total duration, distance,
  airlines and aircraft types.
- **Airport statistics tooltip** — Clicking an IATA code or airport
  point opens a stats card with departures/arrivals, most common
  routes, total kilometers and operating airlines for that airport.
- **Auto-highlight when using "Show on map"** — All flights of a trip
  are automatically selected as soon as the user switches into the
  trip route view via "Show on map".
- **Airport markers on the trip route layer** — Pulsed rings and
  labels for all departure and destination airports of the active
  trip.
- **5 demo trips** — Seed data for new users now includes five
  predefined trips (Barcelona, Dubai & Singapore, Japan, Scandinavia,
  USA West Coast).

### Fixed
- **Tooltips follow the map** — All info windows (flight, trip,
  airport) update their position while scrolling and zooming through
  geo-anchored projection.
- **Trip info card above the arcs** — Tooltip is positioned above the
  bounding box of all airports so it does not sit on top of the route
  lines.
- **Sidebar stays open** — Selecting a trip from the sidebar panel no
  longer auto-closes the panel.
- **Back to the normal view** — Closing the trip tooltip resets
  `visMode` to "routes" and clears the trip selection.
- **Arc click tolerance** — `pickingRadius: 5` on the MapboxOverlay
  fixes the issue where clicks on thin arcs were not registered.
- **deck.gl layer re-rendering** — Colors are pre-computed in the data
  so deck.gl reliably repaints on selection.

Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

---

## [0.10.0-beta] - 2026-04-05 (Update 2)

### Added
- **`operatingAirline` field**: New optional DB field `operating_airline`
  (migration `20260405000000_add_operating_airline`). Stores the
  operating carrier for codeshare flights as well as rail/bus tickets.
- **"Operated by" form field**: Added to `FlightEditModal` and
  `FlightCompleteStep` with `<datalist>` autocomplete.
- **Airline autocomplete**: All airline fields now have browser-native
  `<datalist>` autocomplete with ~75 airlines including rail/bus
  operators (DB, FlixTrain, Flixbus, ÖBB, SBB, TGV, Eurostar).
- **`cleanEmailBody()` utility**: Cleans up plain-text email bodies
  before parsing — strips HTML tags, URLs, normalizes whitespace.
  Mirrors the `filterEmailText` function used in the annotation view.

### Changed
- **Parser runs against cleaned text**: `parseEmail()` applies
  `cleanEmailBody()` before handing text to any parser — parser and
  annotation view now see identical text.
- **`EmailAnnotation` stores filtered text**: `fullText` on annotations
  is stored as `filterEmailText(raw)` instead of raw — annotation
  positions and pattern derivation are consistent.
- **Airline auto-derived**: Post-processing derives the airline name
  from the flight number prefix (`LH2316` → `LH` → `"Lufthansa"`) when
  `airline` is empty.
- **Parser recognizes "operated by"**: Patterns like `"operated by X"`
  / `"durchgeführt von X"` are automatically captured as
  `operatingAirline`.
- **`AIRLINE_IATA_MAP`** expanded from 15 to ~75 airlines.

### Fixed
- **400 error when adding a flight**: The Zod schema threw when
  `airline: ""` (empty string) was submitted. Fix:
  `emptyStringToUndefined` transform on `airline` and `flightNumber` in
  `baseFlightSchema`.
- **LH-old template**: `flightNumber` pattern changed to
  `^([A-Z]{2}\s+\d{3,4})$` — works after `cleanEmailBody()` because
  `<img.png>\tLH 2316\t` becomes `LH 2316` on its own line. Template
  version bumped to `2025-04b` and pushed to the GitHub templates
  repository.

---

## [0.10.0-beta] - 2026-04-04

### Added
- **Enrichment two-mode system**: flights < 1 year → full enrichment
  (aircraft, ICAO codes, route, terminal, gate); flights ≥ 1 year →
  slim enrichment (ICAO codes + terminal only).
- **`getEnrichmentMode()`**: Exported helper that determines enrichment
  mode from flight age.
- **Route median interpolation**: `aggregateRoutes` now resamples all
  reference routes to 20 points and computes per-position median
  lat/lon — replaces the "take newest route" approach.
- **Enrichment badge in PendingUpdateCard**: Full (green) / slim
  (amber) badge plus an "estimated · not verified" disclaimer with
  reference flight count and confidence score.
- **Two-mode explanation panel** in Settings → Enrichment tab.

### Changed
- **`findEnrichmentCandidates`**: Now excludes flights with `pending`
  or `rejected` pending updates (previously only `applied` was excluded
  — caused infinite nightly re-processing).
- **Settings simplified**: `requireApproval` and `autoProcess` removed
  — enrichments always create a pending update requiring manual
  confirmation. Settings reduced from 6 to 3 fields (`enabled`,
  `minConfidence`, `maxPerDay`).
- **Scheduler**: Runs for all users with
  `historicalEnrichmentEnabled=true` (no longer gated on
  `autoProcess`).

### Removed
- **`historicalEnrichmentMaxAgeYears`**,
  **`historicalEnrichmentAutoProcess`**,
  **`historicalEnrichmentRequireApproval`** from the `UserSettings`
  schema and DB.

---

## [0.9.6-beta] - 2026-04-03

### Added
- **Ollama config in admin UI**: `ollamaUrl`, `ollamaModel`,
  `ollamaVisionModel` stored in the `AdminSettings` DB table; editable
  in Admin → Parser Settings.
- **Backup schedule in admin UI**: `backupEnabled`, `backupInterval`,
  `backupRetentionDays` stored in `AdminSettings`; editable in Admin →
  Backup Management.
- **`dateUtils.ts`**: Timezone-aware date/time formatting with
  `Intl.DateTimeFormat`; graceful UTC fallback for invalid timezone
  strings.
- **Timezone-aware flights table**: `FlightsTablePage` now formats
  dates using the user's configured timezone from the settings store.

### Changed
- **`getParserConfig()`**: Reads `ollamaUrl/Model/VisionModel` from the
  `adminSettings` parameter with ENV fallback.
- **`backupScheduler.ts`**: `getBackupSettings()` reads backup config
  from the DB instead of ENV; runtime validation via `VALID_INTERVALS`
  / `toBackupInterval()`.
- **`BackupSection`** (Settings): Now a read-only status view; backup
  schedule configuration moved to Admin → Backup Management.
- **`NotificationsSection`** (Settings): Removed dead toggles; now
  renders only `NotificationPreferences`.

### Removed
- **`debugLoggingEnabled`** + **`requireUserApiKeys`** from
  `AdminSettings` schema — log level from ENV, API keys always
  required.
- **`trainingSeparateModels`** from the `UserSettings` schema.
- **`SystemSettings`** model dropped entirely.
- **Ghost backup/notification fields** from `settingsStore`,
  `useSettingsPage`, API types.

---

## [0.9.5-beta] - 2026-04-03

### Removed
- **LLM training dead code**: Deleted orphaned `TrainingDashboard`,
  `TrainingDataFilters`, `TrainingDataPreview` components (never
  imported after the TrainingPage → ParserPage refactor).
- **Save + Train button**: Removed the LoRA fine-tuning trigger from
  `EmailAnnotation` and `BoardingPassAnnotation` — annotation now
  always derives templates via the `annotate` endpoint only.
- **Dead `trainingApi` methods**: `saveAndTrain`, `trainOnly`,
  `getData`, `getJobs`, `getJobLogs`, `triggerTraining`,
  `cancelTraining`, `deleteTrainingData` removed from the frontend API
  client.
- **Dead TypeScript types**: `TrainingJob`, `TrainingJobLog`,
  `TrainingJobLogsResponse` removed from `types/index.ts`.
- **LLM-only backend endpoints**: `POST /:id/save-and-train`, `POST
  /:id/train-only`, `GET /data`, `GET /jobs`, `GET /jobs/:id/logs`,
  `DELETE /:id`, `POST /trigger`, `POST /jobs/:id/cancel`, `GET
  /data/analysis` removed from the training route.

---

## [0.9.3-beta] - 2026-04-03

### Added
- **Annotation-driven template parser**: Users can annotate parsed
  email fields to derive regex-based templates. Annotated patterns are
  stored as `ParserTemplate` records and applied as step 0 in the
  parser factory for future emails from the same airline.
- **TemplateDeriver**: Derives multi-flight regex templates from user
  annotations (`textSelections`) with field source tracking
  (`fieldSources`).
- **FingerprintMatcher**: Matches incoming emails to existing user
  templates by airline/subject fingerprint.
- **UserTemplateEngine**: Executes derived templates against email
  bodies with multi-flight extraction.
- **Parser templates CRUD API**: `GET/POST/DELETE
  /api/v1/parser-templates` — list, activate, disable, delete
  user-derived templates.
- **TemplateReviewCard**: UI card shown after annotation save to
  display the newly derived template with confidence score.
- **Colour-coded confidence borders** in `FlightReviewModal`: green
  (template match), yellow (LLM fallback).
- **`fieldSources`** on `ParsedBooking` — tracks which field was
  extracted by which method.

### Fixed
- Regex PNR `matchAll` missing `g` flag — caused 500 errors during
  email parsing.
- `GET /api/v1/parser-templates/:id` endpoint added (was missing).
- Body length guard against ReDoS attacks in parser template routes.
- `TemplateReviewCard` async error handling and loading states.

---

## [0.9.2-beta] - 2026-04-02

### Changed
- **Map amber redesign**: The glassmorphism theme now uses TravStats
  brand colors (amber → orange → red) throughout all visualization
  modes. Replaces the previous indigo/cyan color scheme.
- **Filter as FAB**: Filter button moved from the bottom-center bar to
  a bottom-right FAB stack (frosted-glass style, opens upward). The
  mode FAB is stacked above the filter.
- **CSS tokens**: `--map-accent`, `--map-fab-gradient`, `--map-active-*`,
  `--map-badge-*` all updated to amber. Sepia CSS filter on the map
  canvas removed. Dark-matter map style restored unconditionally.

### Added
- **Globe night earth**: Night-earth texture (`earth-night.jpg`) with
  amber atmosphere glow + starfield background (`night-sky.png`) in
  globe mode.
- **Globe legend stacking**: Auto-rotation toggle and route-frequency
  legend share the bottom-left column (no overlap).

### Fixed
- Airport labels (`TextLayer`) now always render above arc lines
  (`depthCompare: "always"`).

---

## [0.9.1-beta] - 2026-03-31

### Added
- **Email import as the primary tab**: Email import promoted to the
  main "Import" tab in the UI. `EmailImportTab` component with drag &
  drop, airline notice and text fallback.
- **Template status view**: Settings page shows GitHub-linked template
  status. New `TemplateStatusView` component + `/api/v1/templates/status`
  endpoint.
- **Duplicate flight detection**: POST `/api/v1/flights` returns 409
  with `existingFlight` details when a duplicate is detected. The
  frontend shows a confirmation dialog with an "Add anyway" option
  (`?force=true` bypass).
- **Year-over-year statistics**:
  `/api/v1/stats/summary?year=YYYY&compareYear=YYYY` with delta badges
  (↑↓ % change).
- **Travel companions**: `companions` field on the Flight model.
  Tag-style input in `SimplifiedFlightFormV2`.
- **Seat statistics**: `GET /api/v1/stats/seats` — distribution by
  position, zone and cabin class.
- **Flight certificate**: `FlightCertificate.tsx` generates a
  downloadable PNG stats card via html2canvas.
- **Email notifications**: SMTP config, per-user notification
  preferences, node-cron reminder scheduler.
- `statsLimiter` (30 req/min) and `adminExportLimiter` (5/hr) rate
  limiters.

### Changed
- **deck.gl visualization**: 6 map modes — routes, heatmap, hexagon
  (3D), 3D columns, trips (animated), globe (react-globe.gl).
- `VisModeSelector`, `TimeSlider`, layer factories for all
  visualization modes.
- Map integration refactored from Leaflet to deck.gl 9.x + MapLibre GL
  5.x.
- `flightNumber` now included in `calculateChanges` comparison fields
  (was silently ignored before).

### Fixed
- Fresh-DB migration ordering: early migrations (`202501xx`) wrapped in
  `IF EXISTS` guards; catch-up migration (`20251221`) recovers all
  columns.
- Backend CI: ESLint added as an explicit dependency, ESLint 9 rule
  violations resolved.
- All 156 backend tests now pass (assertions aligned with actual
  service/route return types).
- GeoJSON layer factories now read from `geometry.coordinates`, not
  unpopulated airport `lat`/`lon` fields.

---

## [0.9.0-beta] - 2026-02-24

First public beta release. Re-versioned from 1.0.x to 0.9.0-beta to
reflect that not all planned features are complete yet.

### Added
- Version badge in About tab (reads from package.json).
- Rate limiting on backup-restore (3/hr) and training-trigger (2/hr)
  endpoints.
- Zod validation for stats route query parameters.
- PayPal donation and GitHub Star buttons in Settings → About.
- i18n translations for all hardcoded strings in
  `SimplifiedFlightForm`.
- Missing `unknownDate` i18n key in dashboard translations.
- i18n translations for hardcoded strings in `DashboardPage` (PDF
  export, map/stats fallbacks).

### Changed
- Package versions bumped to `0.9.0-beta` (frontend + backend).
- Admin page refactored to sidebar layout.
- All plain browser checkboxes replaced with the styled `.checkbox`
  class.

### Fixed
- `alert()` calls in AchievementsPage replaced with toast
  notifications.
- `console.debug()` calls in `barcodeExtractor.ts` replaced with
  `logger.debug()`.
- Dark mode issues across all pages (hardcoded Tailwind colors → CSS
  variables).

---

## [1.0.1] - 2026-02-23

### Added
- Prettier formatter for frontend TypeScript/TSX/CSS (`format` and
  `format:check` scripts).
- ts-prune dead code detection scripts in frontend and backend
  (`dead-code` script).
- Vitest coverage reporting with v8 provider and regression thresholds
  (`test:coverage` script).
- ruff.toml Python linter config; auto-fixed 220 issues in training
  scripts.
- bandit security config (`.bandit.yml`) for Python script scanning.
- License whitelist (`LICENSE_WHITELIST.txt`) covering all project
  dependencies.
- Pre-commit hooks: trailing whitespace, YAML/JSON validation, secret
  detection, ruff, Prettier.
- GitHub Actions CI workflow: backend (typecheck + lint + test with
  Postgres), frontend (typecheck + lint + format + coverage), Python
  (ruff + bandit).
- Dev setup scripts (`scripts/setup-dev.sh` and
  `scripts/setup-dev.ps1`) for onboarding.
- Smoke test script (`scripts/smoke-test.sh`) for post-deploy
  verification.

### Changed
- Docker security hardening: `cap_drop: ALL` + minimal `cap_add`,
  `no-new-privileges`, log rotation, and resource limits on `app`,
  `db`, and `ollama` services.

### Fixed
- Removed unnecessary `CAP_SETUID`/`CAP_SETGID` from the app container
  (root can setuid without them).
- Corrected the pre-commit prettier hook entry to properly forward
  filenames (`npx --prefix frontend prettier --write`).
- Removed dead coverage config block from `vite.config.ts` (shadowed
  by `vitest.config.ts`).

## [1.0.0] - 2026-02-23

### Added
- Initial stable release.
- Flight tracking with map visualization (Leaflet, 3D globe).
- Statistics dashboard (distance, time, routes, heatmaps).
- Achievements & gamification system (20+ badges).
- Boarding pass scanner (QR/barcode + OCR via Tesseract.js).
- Email booking import (manual upload + IMAP polling).
- Flight data lookup (AirLabs API integration).
- OpenFlights airport database (~14,000 airports).
- Export: CSV, GeoJSON, KML.
- Tags & categories (business/private).
- Cost tracking per flight.
- Dark/light mode.
- Multi-language support (DE/EN).
- LLM-powered parsing (Ollama integration).
- LoRA fine-tuning pipeline for email/boarding-pass models.
- Pre-training data quality analysis (`checkTrainingData.py`).
- Post-training model evaluation (`evalModel.py`).
- Training metrics parsing (loss, steps, epochs).
- Docker deployment with nginx + supervisor.
- JWT authentication with secure cookie handling.
