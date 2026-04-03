# Changelog

All notable changes to TravStats are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

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
