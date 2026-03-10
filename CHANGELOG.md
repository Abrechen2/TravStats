# Changelog

All notable changes to TravStats are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

### Added
- **Duplicate Flight Detection**: POST `/api/v1/flights` returns 409 with `existingFlight` details when duplicate detected (same flightNumber + calendar day). Frontend shows confirmation dialog with "Add Anyway" option (uses `?force=true` bypass). Indexed query for O(1) performance.
- **Year-over-Year Statistics**: `/api/v1/stats/summary?year=YYYY&compareYear=YYYY` returns `{ current: SummaryStats, compare: SummaryStats }`. Frontend `AdvancedStatsPage` shows year dropdown + compare toggle with delta badges (↑↓ % change). Backend helpers: `buildWhere()` (filter by year) and `computeSummary()` (5-query aggregation).
- **Travel Companions**: `companions` field added to Flight model (max 50 entries × 100 chars each). Tag-style input in `SimplifiedFlightFormV2`. Zod schema validation.
- **Seat Statistics**: New `GET /api/v1/stats/seats` endpoint returns distribution by position (window/middle/aisle), zone (front/bulkhead/exit/standard), and cabin class (economy/business/etc). Detects wide-body (A-K columns) vs narrow-body (A-F) layouts.
- **Flight Certificate**: New `FlightCertificate.tsx` component generates downloadable PNG stats card using html2canvas (scale:2 for retina display). Shows total flights, total distance, total flight time, top airline, years active, user name. Button in `AdvancedStatsPage` when flights are loaded.
- **Email Notifications**: Singleton `SmtpConfig` model (id=1) for SMTP configuration. User model enhanced with `notificationEmail`, `notifyBefore24h`, `notifyBefore2h` fields.
  - Services: `emailService.ts` (nodemailer HTML templates), `reminderScheduler.ts` (node-cron every 15 min with in-memory dedup Set)
  - Admin routes: `GET/PUT/POST /api/v1/admin/smtp` (password always masked in responses)
  - User routes: `GET/PUT /api/v1/settings/notifications` (email + threshold preferences)
  - Frontend: `Admin/SmtpManager.tsx` (SMTP config UI), `Settings/NotificationPreferences.tsx` (user preferences)
- `statsLimiter` (30 req/min) and `adminExportLimiter` (5/hr) rate limiters on protected endpoints
- Zod validation on 5 test endpoints: `/api/v1/stats/summary` (year range 1900-2100), `/api/v1/airports/enrich`, `/api/v1/settings/apiKeys`, `/api/v1/stats/seats`, `/api/v1/admin/smtp/*` (full SmtpConfig validation)

### Changed
- **deck.gl visualization**: 6 switchable map modes — Routes (arc layer), Heatmap, Hexagon (3D), 3D Columns, Trips (animated with TimeSlider), and Globe (react-globe.gl)
- `VisModeSelector` component to switch between all visualization modes from any view
- `TimeSlider` component for Trips mode animation playback
- Layer factories for each visualization mode (`routesLayer`, `heatmapLayer`, `hexagonLayer`, `columnsLayer`, `tripsLayer`)
- Map integration refactored from Leaflet to deck.gl 9.x + MapLibre GL 5.x (`DeckGLMap` component)
- `MapboxOverlay` + `useControl` pattern used for deck.gl/MapLibre integration (avoids WebGL context conflict)
- `VisModeSelector` moved to `MapContainer3D` level so it remains visible in Globe mode

### Fixed
- All layer factories now read coordinates from `geometry.coordinates` (GeoJSON LineString), not from airport property `lat`/`lon` fields which the API does not populate

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
