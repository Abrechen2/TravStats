# Codebase Structure

**Analysis Date:** 2026-04-03

## Directory Layout

```
TravStats/
├── backend/                  # Express/TypeScript API server
│   ├── src/                  # All TypeScript source
│   │   ├── index.ts          # Express app entry point
│   │   ├── db.ts             # Prisma client singleton
│   │   ├── init.ts           # DB initialization helpers
│   │   ├── seed.ts           # DB seeding scripts (dev)
│   │   ├── routes/           # HTTP route handlers (one file per domain)
│   │   ├── middleware/       # Express middleware
│   │   ├── services/         # Business logic and external integrations
│   │   ├── jobs/             # Background scheduled jobs
│   │   ├── schemas/          # Zod validation schemas
│   │   ├── config/           # Env config and app-wide constants
│   │   ├── utils/            # Pure utility functions
│   │   └── scripts/          # One-off data scripts
│   ├── prisma/               # Prisma schema and migrations
│   │   ├── schema.prisma     # Database model definitions
│   │   └── migrations/       # Prisma migration files
│   ├── data/                 # Runtime data (gitignored)
│   │   ├── logs/             # Pino rotating log files
│   │   ├── backups/          # Automated DB backups
│   │   └── training/         # LLM training output
│   ├── dist/                 # TypeScript compiled output (gitignored)
│   ├── VERSION               # Source-of-truth version string (e.g. 0.9.0-beta)
│   ├── package.json
│   └── tsconfig.json
├── frontend/                 # React/Vite/TypeScript SPA
│   ├── src/
│   │   ├── main.tsx          # React entry — mounts app to DOM
│   │   ├── App.tsx           # Root component: routing, auth guard, lazy pages
│   │   ├── pages/            # Route-level page components
│   │   ├── components/       # Reusable UI components (feature-organized)
│   │   ├── store/            # Zustand state stores
│   │   ├── lib/              # API client (api.ts), logger
│   │   ├── hooks/            # Custom React hooks
│   │   ├── i18n/             # react-i18next config and translation resources
│   │   ├── types/            # Shared TypeScript type definitions
│   │   ├── config/           # Frontend constants
│   │   └── __tests__/        # Vitest test files
│   ├── public/               # Static assets
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── scripts/                  # Dev and deployment shell/PS scripts
├── .github/workflows/        # CI/CD GitHub Actions
├── .planning/                # Architecture and planning docs (this dir)
│   └── codebase/             # Codebase analysis documents
├── CLAUDE.md                 # Project-level instructions for Claude
├── CHANGELOG.md              # Version changelog
├── package.json              # Root workspace scripts (install:all, dev, etc.)
└── Dockerfile                # Single-image build (backend serves frontend static files)
```

## Backend — Directory Purposes

**`backend/src/routes/`**
- Purpose: Express Router files, one per domain; handle HTTP in/out, validate input, call services/db, return JSON
- Pattern: `router.METHOD('/path', [middleware], async handler)`
- Files:
  - `auth.ts` — login, register, logout, change password, invite
  - `flights.ts` — CRUD for flights, GeoJSON endpoint
  - `flightLookup.ts` — live flight data lookup from external APIs
  - `stats.ts` — aggregated statistics (distance, airlines, countries, etc.)
  - `airports.ts` — airport search and lookup
  - `achievements.ts` — user achievement progress
  - `settings/` — user settings sub-router (split into sub-files by feature group)
    - `general.ts`, `display.ts`, `notifications.ts`, `parser.ts`, `apiKeys.ts`, `onboarding.ts`, `training.ts`, `developer.ts`, `smtp.ts`, `types.ts`
  - `admin/` — admin-only management sub-router (same structure as settings)
  - `emailParse.ts` — email text/file import parsing
  - `boardingpassParse.ts` — boarding pass image parsing
  - `pdfParse.ts` — PDF booking parsing
  - `parserFeedback.ts` — parser correction submissions
  - `parserTemplates.ts` — user parser template CRUD
  - `templateStatus.ts` — parser template status reporting
  - `uploads.ts` — file upload handling (multer)
  - `analytics.ts` — analytics event tracking
  - `training.ts` — LLM training job management
  - `pendingUpdates.ts` — pending flight update review/approval
  - `backup.ts` — manual backup trigger and listing
  - `setup.ts` — first-run setup and airport seeding status
  - `admin.ts` — admin top-level router (mounts `admin/` sub-files)

**`backend/src/middleware/`**
- `auth.ts` — `authenticate` (JWT cookie → `req.userId`) and `requireAdmin` (checks `isAdmin` in DB)
- `errorHandler.ts` — global error handler; defines `AppError` class
- `rateLimit.ts` — named rate limiter instances: `authLimiter`, `adminExportLimiter`
- `requestLogger.ts` — correlation ID attachment and structured HTTP logging
- `upload.ts` — multer configuration for file upload routes
- `trainingAuth.ts` — auth middleware specific to training routes

**`backend/src/services/`**
- `parsers/` — entire parser subsystem (see below)
- `bookingParser.ts` — structured data extraction from booking text
- `boardingPassParser.ts` — boarding pass parsing orchestration
- `pdfParser.ts` — PDF text extraction
- `emailExtractor.ts` — MIME email parsing (text/html extraction)
- `emailService.ts` — SMTP email sending (flight reminders)
- `flightEnrichmentService.ts` — enriches stored flights with live API data
- `flightLookup.ts` — routes flight lookup queries to enabled API providers
- `flightAutoUpdate.ts` — applies approved pending updates to flights
- `pendingUpdateService.ts` — creates and manages `PendingFlightUpdate` records
- `airportCache.ts` — bounded in-memory airport cache
- `airportLookup.ts` — resolves IATA/ICAO codes to airport records
- `airportSeedingService.ts` — bulk airport DB population from CSV
- `co2Calculator.ts` — flight CO₂ emission calculations
- `backupService.ts` — DB dump + file archive creation
- `backupScheduler.ts` — cron-based auto-backup
- `cloudSyncService.ts` — WebDAV upload of backup archives
- `reminderScheduler.ts` — sends flight reminder emails
- `trainingService.ts` — LLM fine-tune job orchestration
- `trainingRecorder.ts` — records parse results to `ParseTrainingLog`
- `annotationService.ts` — manages `TrainingData` annotations
- `modelManager.ts` — manages trained model files
- `patternAnalyzer.ts`, `patternUpdater.ts` — parser pattern analysis
- `parserFeedback.ts` — feedback collection and low-quality parse flagging
- `parserSettings.ts` — resolves active parser settings for a user
- `loggingConfig.ts` — queries `AdminSettings` for dynamic log level
- `logManager.ts` — log file management (list, delete)
- `routeEstimationService.ts` — estimates flight route from airport coordinates
- `apiKeyResolver.ts`, `apiKeyTester.ts` — resolves and tests API keys (user vs. global)
- `hardwareService.ts` — server hardware info for admin panel
- `llmParser.ts`, `llmParser.enhanced.ts` — base LLM parse helpers
- `ollamaVisionParser.ts` — standalone Ollama vision client (also referenced from parsers/)

**`backend/src/services/parsers/`**
- `factory.ts` — `ParserFactory`; provider selection, auto-mode, fallback chain, availability caching
- `types.ts` — `IVisionParser`, `ITextParser`, provider enums, `ParserResult`, `ParserConfig`
- `vision/` — one file per vision provider: `ollamaVisionParser.ts`, `openaiVisionParser.ts`, `claudeVisionParser.ts`, `tesseractParser.ts`, `manualParser.ts`
- `text/` — one file per text provider: `ollamaTextParser.ts`, `openaiTextParser.ts`, `claudeTextParser.ts`, `regexParser.ts`, `templateParser.ts`
- `templates/` — airline template system:
  - `registry.ts` — loads templates, caches for server lifetime
  - `engine.ts` — applies template to input text
  - `detector.ts` — fingerprints input to match airline
  - `types.ts` — template type definitions
  - `airlines/` — per-airline template files (e.g., `lh.ts`, `fr.ts`)
- `userTemplates/` — user-created templates:
  - `matcher.ts` — finds matching user template from DB
  - `engine.ts` — applies user template
- `shared/` — shared utilities across providers (e.g., `utils.ts`)

**`backend/src/jobs/`**
- `flightUpdateScheduler.ts` — interval-based scheduler; calls `flightLookup` then creates `PendingFlightUpdate`
- `historicalEnrichmentScheduler.ts` — enriches older flight records from historical APIs

**`backend/src/schemas/`**
- Zod schemas used in route handlers for input validation
- `auth.ts` — `registerSchema`, `loginSchema`, `changePasswordSchema`
- `flight.ts` — `flightCreateSchema`, `flightUpdateSchema`, `flightFiltersSchema`
- `achievements.ts` — achievements query schema
- `admin.ts` — admin settings update schemas

**`backend/src/config/`**
- `env.ts` — Zod env schema; exports `validateEnv()` and `getEnv()`; called at server startup
- `constants.ts` — exports `RATE_LIMITS` and `FILE_LIMITS` objects

**`backend/src/utils/`**
- `logger.ts` — Pino multi-transport logger; exports named loggers: `logger` (default), `dbLogger`, `parserFactoryLogger`, `parserVisionLogger`, `parserTextLogger`, `securityLogger`
- `password.ts` — bcrypt hash/compare
- `jwt.ts` — `generateToken()`, `verifyToken()`
- `jwtSecret.ts` — reads JWT_SECRET from env or secrets file
- `encryption.ts` — AES encrypt/decrypt for API keys; `encryptApiKey()`, `decryptApiKey()`
- `encryptionKey.ts` — reads ENCRYPTION_KEY from env or secrets file
- `database.ts` — builds `DATABASE_URL` from individual DB env vars (`DB_HOST`, `DB_PORT`, etc.)
- `statsCalculator.ts` — pure aggregation functions (distance, rankings, streaks) used in stats routes
- `geo.ts` — `haversineDistance()`, `calculateBearing()`
- `serializeBigInt.ts` — replaces BigInt in response objects for JSON serialization
- `timezone.ts` — timezone conversion helpers
- `fileValidation.ts` — MIME type and extension checks for uploads

**`backend/prisma/`**
- `schema.prisma` — all model definitions; PostgreSQL + PostGIS extension
- `migrations/` — timestamped migration directories; never edit manually, use `npx prisma migrate dev`

## Frontend — Directory Purposes

**`frontend/src/pages/`**
- Route-level components, lazy-loaded in `App.tsx`
- `DashboardPage.tsx` — main overview: stats summary, recent flights, map
- `FlightsTablePage.tsx` — paginated/filterable flight list with inline edit
- `AdvancedStatsPage.tsx` — detailed statistics and charts
- `AchievementsPage.tsx` — achievement grid and progress
- `SettingsPage.tsx` — user settings (profile, display, notifications, parser, API keys)
- `AdminPage.tsx` — admin panel (user mgmt, system settings, logs, backup, parser stats)
- `ParserPage.tsx` — 4-tab parser workspace (Annotate / My Templates / Community / Parse Logs)
- `PendingUpdatesPage.tsx` — review and approve pending flight updates
- `LoginPage.tsx`, `RegisterPage.tsx` — auth forms
- `SetupPage.tsx` — first-run setup wizard

**`frontend/src/components/`**
- Reusable components, organised by feature area:
  - `Admin/` — admin-panel sub-components: `UserManagement.tsx`, `BackupManagement.tsx`, `LoggingManager.tsx`, `GlobalApiKeysManager.tsx`, `FeedbackAnalytics.tsx`, `InvitationManagement.tsx`, `ParserSettings.tsx`, `PatternManagement.tsx`, `SmtpManager.tsx`, `SystemInfo.tsx`
  - `Settings/` — settings panel sub-components: `ApiKeyCard.tsx`, `NotificationPreferences.tsx`, `ParserConfiguration.tsx`
  - `Parser/` — parser page sub-components: `MyTemplates.tsx`
  - `Training/` — annotation UI: `BoardingPassAnnotation.tsx`, `EmailAnnotation.tsx`, `ParseLogStats.tsx`, `TemplateReviewCard.tsx`
  - `Stats/` — statistics chart cards: `AirlineRankingCard.tsx`, `CountryDistributionCard.tsx`
  - `Onboarding/` — first-use guides: `OnboardingGuide.tsx`, `OnboardingStep.tsx`, `ContextualHint.tsx`
  - `Help/` — contextual help components: `HelpIcon.tsx`, `InlineHelp.tsx`, `Tooltip.tsx`
  - `import/` — email import workflow: `EmailImportTab.tsx`
  - `layers/` — deck.gl layer factories: `routesLayer.ts`, `heatmapLayer.ts`, `hexagonLayer.ts`, `tripsLayer.ts`, `columnsLayer.ts`, `contourLayer.ts`, `layerTypes.ts`
- Key standalone components:
  - `MapContainer3D.tsx` — deck.gl + MapLibre 3D map wrapper with `VisModeSelector`
  - `DeckGLMap.tsx` — inner deck.gl `MapboxOverlay` + `useControl` integration
  - `GlobeView.tsx` — react-globe.gl globe mode
  - `NavigationBar.tsx` — top navigation with auth state
  - `FlightEditModal.tsx` — flight create/edit form
  - `FlightReviewModal.tsx` — post-parse review before save
  - `SimplifiedFlightFormV2.tsx` — quick-add flight form
  - `BoardingPassScanner.tsx` — camera/upload boarding pass scan UI
  - `PendingUpdateCard.tsx`, `PendingUpdateEditor.tsx` — pending update review UI
  - `YearHeatmap.tsx` — flight frequency calendar heatmap
  - `FlightCalendar.tsx` — monthly flight calendar
  - `FlightCertificate.tsx` — shareable flight summary
  - `AirportAutocomplete.tsx` — IATA/ICAO airport search input
  - `DataSourceBadges.tsx` — data provenance indicators
  - `SkeletonLoader.tsx` — loading placeholders
  - `Toast.tsx` — toast notification display
  - `ErrorBoundary.tsx` — React error boundary
  - `AirportSeedingBanner.tsx`, `AirportSeedingModal.tsx` — airport data loading status

**`frontend/src/store/`**
- Zustand stores with `persist` middleware (localStorage):
  - `authStore.ts` — `user` object, `logout()`, hydration guard `_hasHydrated`
  - `settingsStore.ts` — all user preferences (`display`, `units`, `defaults`, `privacy`, `notifications`, `backup`, `export`, `map`, `parser`, `apiKeys`); `loadRemoteSettings()` syncs from API
  - `themeStore.ts` — `isDarkMode`, `toggleDarkMode()`
  - `toastStore.ts` — `toasts[]`, `addToast()`, `removeToast()`

**`frontend/src/lib/`**
- `api.ts` — all backend API calls grouped by domain; Axios with `withCredentials: true`; 401 → `auth:unauthorized` event
- `logger.ts` — thin logging wrapper (suppressed in production)

**`frontend/src/hooks/`**
- `useTranslation.ts` — wrapper around `react-i18next`; ALWAYS import from here, not `react-i18next`
- `useClickOutside.ts` — ref-based click-outside detection

**`frontend/src/i18n/`**
- `config.ts` — i18next initialisation
- `resources/` — translation namespace files organised as `{lang}/{namespace}.ts` (e.g., `de/common.ts`, `en/parser.ts`)

**`frontend/src/types/`**
- `index.ts` — all shared TypeScript types: `User`, `Flight`, `FlightInput`, `FlightFilters`, `Route`, `GeoJSONFeatureCollection`, `ParsedBooking`, `AchievementsResponse`, etc.

**`frontend/src/config/`**
- `constants.ts` — `API_TIMEOUTS` and other frontend constants
- `mapTheme.ts` — MapLibre style configuration
- `visMode.ts` — visualization mode type definitions

## Key File Locations

**Entry Points:**
- `backend/src/index.ts` — Express server startup and route registration
- `frontend/src/main.tsx` — React DOM mount
- `frontend/src/App.tsx` — routing, auth guard, global UI shell

**Database:**
- `backend/prisma/schema.prisma` — single source of truth for all DB models
- `backend/src/db.ts` — Prisma singleton with query logging middleware

**Auth:**
- `backend/src/middleware/auth.ts` — JWT cookie verification, admin guard
- `backend/src/routes/auth.ts` — login/register/logout endpoints
- `frontend/src/store/authStore.ts` — client auth state

**Configuration:**
- `backend/src/config/env.ts` — all environment variables with Zod types
- `backend/src/config/constants.ts` — rate limits and file size limits
- `backend/VERSION` — version string (source of truth for releases)

**Parser System:**
- `backend/src/services/parsers/factory.ts` — provider selection and fallback
- `backend/src/services/parsers/types.ts` — parser interfaces
- `backend/src/routes/emailParse.ts`, `boardingpassParse.ts`, `pdfParse.ts` — parser entry routes

**Background Jobs:**
- `backend/src/jobs/flightUpdateScheduler.ts` — live flight update polling
- `backend/src/jobs/historicalEnrichmentScheduler.ts` — historical enrichment
- `backend/src/services/backupScheduler.ts` — automated backup cron
- `backend/src/services/reminderScheduler.ts` — email reminder cron

## Naming Conventions

**Files:**
- Backend services: `camelCase.ts` (e.g., `flightEnrichmentService.ts`)
- Backend routes: `camelCase.ts` matching domain name (e.g., `pendingUpdates.ts`)
- Frontend pages: `PascalCasePage.tsx` (e.g., `FlightsTablePage.tsx`)
- Frontend components: `PascalCase.tsx` (e.g., `NavigationBar.tsx`)
- Frontend stores: `camelCaseStore.ts` (e.g., `authStore.ts`)
- Test files: co-located with `*.test.ts(x)` suffix or in `__tests__/`

**Exports:**
- Backend: named exports for all middleware, services, utils; `export default app` from `index.ts`
- Frontend: default export for page/component files; named exports for stores (`useAuthStore`) and API objects (`authApi`)

## Where to Add New Code

**New API endpoint (backend):**
1. Add Zod schema to `backend/src/schemas/{domain}.ts`
2. Create or extend route file in `backend/src/routes/{domain}.ts`
3. Register router in `backend/src/index.ts` under `/api/v1/`
4. Add corresponding API function to `frontend/src/lib/api.ts`

**New page (frontend):**
1. Create `frontend/src/pages/{Name}Page.tsx`
2. Add lazy import and `<Route>` in `frontend/src/App.tsx`
3. Add nav link to `frontend/src/components/NavigationBar.tsx`

**New reusable component:**
- Domain-specific: `frontend/src/components/{FeatureArea}/{ComponentName}.tsx`
- Generic shared: `frontend/src/components/{ComponentName}.tsx`

**New service (backend):**
- Business logic: `backend/src/services/{domainName}Service.ts`
- Background job: `backend/src/jobs/{name}Scheduler.ts` + register startup in `index.ts`

**New parser provider:**
- Vision: `backend/src/services/parsers/vision/{provider}VisionParser.ts` implementing `IVisionParser`
- Text: `backend/src/services/parsers/text/{provider}TextParser.ts` implementing `ITextParser`
- Register in `factory.ts` switch statements

**New airline template:**
- Add file to `backend/src/services/parsers/templates/airlines/{iata}.ts`
- Registry loads it automatically on server startup

**New Zustand store:**
- `frontend/src/store/{name}Store.ts`; use `create<State>()` with `persist` if persistence needed

**New i18n namespace:**
- Add `frontend/src/i18n/resources/de/{namespace}.ts` and `en/{namespace}.ts`
- Register namespace in `frontend/src/i18n/config.ts`

## Special Directories

**`backend/data/`:**
- Purpose: runtime-generated data — logs, backups, ML training output
- Generated: Yes
- Committed: No (gitignored)

**`backend/dist/`:**
- Purpose: TypeScript compiled output
- Generated: Yes
- Committed: No

**`backend/prisma/migrations/`:**
- Purpose: Prisma migration SQL — tracks schema history
- Generated: By `npx prisma migrate dev`
- Committed: Yes (required for production deployments)

**`.planning/`:**
- Purpose: architecture analysis docs, phase plans
- Generated: By Claude agents
- Committed: Yes (team reference)

**`.github/workflows/`:**
- Purpose: CI/CD pipelines
- Key files: `release.yml` (triggered by version tags to build Docker image)
- Note: `docker-build.yml` PR trigger removed (caused timeout issues)

---

*Structure analysis: 2026-04-03*
