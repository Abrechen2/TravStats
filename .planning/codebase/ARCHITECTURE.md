# Architecture

**Analysis Date:** 2026-04-03

## Pattern Overview

**Overall:** Monolithic full-stack web application with layered backend and component-based frontend.

**Key Characteristics:**
- Express REST API backend (port 8000) serving a React SPA frontend (port 3000 in dev)
- In production: both served same-origin behind nginx reverse proxy — CORS disabled by default
- JWT authentication via HttpOnly cookies (not Bearer tokens)
- Prisma ORM as the single database access layer; direct `prisma` calls from route handlers (no repository abstraction layer)
- Background schedulers run inside the Express process on startup

## Layers

**Entry Point — `backend/src/index.ts`:**
- Purpose: Express app bootstrap, middleware registration, route mounting, scheduler startup
- Middleware order: `helmet` → `cors` → `rateLimit` → `express.json` → `cookieParser` → `requestLoggerMiddleware`
- All routes mounted under `/api/v1/` prefix; health check at `/health`
- Error handling: single global `errorHandler` at the end of the middleware chain
- Schedulers started via dynamic `import()` after server binds: `backupScheduler`, `flightUpdateScheduler`, `historicalEnrichmentScheduler`, `reminderScheduler`
- Template registry initialised: `backend/src/services/parsers/templates/registry.ts`

**Routes — `backend/src/routes/`:**
- Purpose: HTTP request handling — validate input with Zod, call service/db, return JSON
- Each file owns one domain (e.g., `flights.ts`, `auth.ts`, `stats.ts`)
- Complex domains split into subdirectories: `routes/admin/` (smtp, apiKeys, developer, general, notifications, onboarding, parser, training) and `routes/settings/` (same sub-files)
- Route handlers call `prisma` directly for simple CRUD; delegate to `services/` for complex logic
- Protected routes apply `authenticate` middleware; admin-only routes additionally apply `requireAdmin`

**Middleware — `backend/src/middleware/`:**
- `auth.ts` — JWT cookie verification, attaches `req.userId`; `requireAdmin` guard for admin routes
- `errorHandler.ts` — catches `AppError` and `ZodError`; returns structured JSON; logs via Pino
- `rateLimit.ts` — separate limiters: `authLimiter` (strict), `adminExportLimiter`, and a general limiter on all `/api/` routes (disabled in non-production)
- `requestLogger.ts` — attaches correlation request IDs and logs HTTP in/out
- `upload.ts` — multer configuration for file uploads

**Services — `backend/src/services/`:**
- Purpose: business logic, external integrations, background work
- Key services:
  - `parsers/` — multi-provider parser subsystem (see Parser Subsystem section)
  - `bookingParser.ts` — booking/reservation text extraction
  - `boardingPassParser.ts` — boarding pass image/text extraction
  - `pdfParser.ts` — PDF extraction
  - `emailExtractor.ts` — email MIME parsing
  - `flightEnrichmentService.ts` — enriches flight records with live API data
  - `flightAutoUpdate.ts` — applies pending flight updates from enrichment
  - `backupService.ts`, `backupScheduler.ts` — automated DB backups
  - `reminderScheduler.ts` — email flight reminders via SMTP
  - `airportCache.ts`, `airportLookup.ts` — in-memory airport lookup with bounded LRU cache
  - `co2Calculator.ts` — CO₂ emission estimation
  - `trainingService.ts`, `trainingRecorder.ts` — LLM fine-tuning workflow
  - `cloudSyncService.ts` — WebDAV backup sync
  - `annotationService.ts` — parser annotation storage
  - `loggingConfig.ts` — dynamic log level queries from `AdminSettings`

**Jobs — `backend/src/jobs/`:**
- `flightUpdateScheduler.ts` — polls flight APIs every 15 min (default), creates `PendingFlightUpdate` records
- `historicalEnrichmentScheduler.ts` — enriches older flights from historical API data

**Schemas — `backend/src/schemas/`:**
- Purpose: Zod validation schemas used in route handlers
- Files: `auth.ts`, `flight.ts`, `achievements.ts`, `admin.ts`
- All user-facing inputs validated here before touching the DB

**Utils — `backend/src/utils/`:**
- `logger.ts` — Pino multi-transport logger with rotating file streams (app.log, error.log, http.log, parser*.log); exposes named loggers per category
- `password.ts` — bcrypt hashing/comparison
- `jwt.ts`, `jwtSecret.ts` — JWT sign/verify
- `encryption.ts`, `encryptionKey.ts` — AES encryption for stored API keys
- `database.ts` — builds `DATABASE_URL` from individual DB env vars
- `statsCalculator.ts` — aggregation helpers used in stats routes
- `geo.ts` — great-circle distance, bearing calculations
- `serializeBigInt.ts` — BigInt JSON serialization helper
- `timezone.ts`, `fileValidation.ts` — misc utilities

**Config — `backend/src/config/`:**
- `env.ts` — Zod-validated env schema; `validateEnv()` called at startup; fails fast if required vars missing
- `constants.ts` — rate limit values, file size limits, exported as `RATE_LIMITS` and `FILE_LIMITS`

**Database — `backend/src/db.ts`:**
- Singleton `PrismaClient` instance exported as `prisma`
- Prisma middleware intercepts all queries for: structured logging (when `logDatabaseQueries` enabled) and redaction of sensitive fields (passwords, API keys)
- Connection errors logged as warnings (expected during startup/shutdown)

**Frontend State — `frontend/src/store/`:**
- `authStore.ts` — Zustand + persist; stores `user` object (not token); JWT lives in HttpOnly cookie; listens for `auth:unauthorized` events to auto-logout
- `settingsStore.ts` — Zustand + persist; syncs with backend `UserSettings`; structured into sub-namespaces: `display`, `units`, `defaults`, `privacy`, `notifications`, `backup`, `export`, `map`, `parser`, `apiKeys`
- `themeStore.ts` — dark/light mode, applies CSS class to `document.documentElement`
- `toastStore.ts` — toast notification queue

**Frontend API Client — `frontend/src/lib/api.ts`:**
- Axios instances with `withCredentials: true` (required for HttpOnly cookie auth)
- Grouped API objects: `authApi`, `flightsApi`, `statsApi`, `achievementsApi`, `settingsApi`, `setupApi`, `adminApi`, `parserApi`, `parserTemplatesApi`, etc.
- 401 responses dispatch `auth:unauthorized` window event → `authStore` auto-logout
- Timeout constants imported from `frontend/src/config/constants.ts`

## Parser Subsystem

The parser subsystem (`backend/src/services/parsers/`) is the most complex domain:

**Architecture:**
- `factory.ts` — `ParserFactory` class; manages provider selection, auto-mode, and fallback chains; 5-minute availability cache per provider
- `types.ts` — `IVisionParser` / `ITextParser` interfaces, `VisionProvider` / `TextProvider` unions, `ParserResult`, `ParserConfig`

**Vision providers** (`parsers/vision/`):
- `ollamaVisionParser.ts` — local Ollama LLM (multimodal)
- `openaiVisionParser.ts` — OpenAI GPT-4o vision
- `claudeVisionParser.ts` — Anthropic Claude vision
- `tesseractParser.ts` — local OCR fallback
- `manualParser.ts` — manual entry fallback

**Text providers** (`parsers/text/`):
- `ollamaTextParser.ts` — local Ollama
- `openaiTextParser.ts` — OpenAI
- `claudeTextParser.ts` — Anthropic Claude
- `regexParser.ts` — regex-based fallback
- `templateParser.ts` — airline template matching engine

**Template system** (`parsers/templates/`):
- `registry.ts` — loads and caches airline-specific templates; initialised at server startup
- `engine.ts` — applies a matched template to extract structured fields
- `detector.ts` — fingerprints input to identify airline/email type
- `airlines/` — per-airline template definition files

**User templates** (`parsers/userTemplates/`):
- `matcher.ts` — matches user-created templates stored in `ParserTemplate` DB table
- `engine.ts` — applies matched user template

**Fallback chain:** auto-mode tries providers in order defined by `visionFallbackChain` / `textFallbackChain` settings (e.g., `"ollama,openai,claude,tesseract,manual"`), per user preference or system default.

## Data Flow

**Authenticated API Request:**
1. Browser sends request with HttpOnly cookie (`auth_token`)
2. Express: `helmet` (security headers) → `rateLimit` → `express.json` (body parse) → `cookieParser` → `requestLogger` (attach request ID)
3. `authenticate` middleware: reads cookie, verifies JWT, looks up user in DB, attaches `req.userId`
4. Route handler: validates body/params via Zod schema (`schemas/`)
5. Route handler: calls Prisma directly or delegates to a service
6. Prisma middleware: logs query (if enabled), redacts sensitive fields on error
7. Service or route: builds response, serialises BigInt if needed
8. Response sent as JSON; `errorHandler` catches any thrown `AppError` or `ZodError`

**Parser Flow (email/boarding pass):**
1. Client POSTs file or text to `POST /api/v1/email-parse`, `/boarding-pass-parse`, or `/pdf-parse`
2. Route handler validates input, reads file via multer
3. Calls `ParserFactory` with user settings (preferred provider, fallback chain, API keys)
4. Factory checks provider availability (cached 5 min)
5. Primary provider attempted; on failure, next in fallback chain tried
6. Result returned as `ParsedBooking[]`
7. `trainingRecorder.ts` logs parse result to `ParseTrainingLog`
8. Client presents result for user review before flight creation

**Flight Update Flow:**
1. `flightUpdateScheduler` runs every 15 min → queries flights with `status=scheduled` and `departureTime` within window
2. Calls flight API (AirLabs / AviationStack / OpenSky) via `flightLookup.ts`
3. Diffs actual vs stored data → creates `PendingFlightUpdate` records in DB
4. Client polls `GET /api/v1/pending-updates` → displays `PendingUpdateCard` for review
5. User approves/rejects/edits → `PATCH /api/v1/pending-updates/:id`
6. `pendingUpdateService.ts` applies or discards changes

## Entry Points

**Backend:**
- Location: `backend/src/index.ts`
- Triggers: `node dist/index.js` or `ts-node src/index.ts` (dev)
- Responsibilities: create Express app, register all middleware and routes, start background schedulers, connect Prisma

**Frontend:**
- Location: `frontend/src/main.tsx`
- Triggers: Vite dev server or static build served by Express/nginx
- Responsibilities: mount React root, wrap with `BrowserRouter`

**Frontend App Shell:**
- Location: `frontend/src/App.tsx`
- Responsibilities: setup check on load, auth hydration guard, lazy-load all pages, route definitions, language/theme sync, global `Toast` and `ErrorBoundary`

## Authentication

**Mechanism:** JWT stored in HttpOnly, SameSite=Lax cookie (`auth_token`), 7-day expiry
- Cookie set on `POST /api/v1/auth/login` and `POST /api/v1/auth/register`
- Cookie cleared on `POST /api/v1/auth/logout`
- `withCredentials: true` required on all Axios calls
- `authenticate` middleware: cookie → fallback Bearer header (backwards compatibility)
- Admin access: additional `requireAdmin` middleware checks `user.isAdmin` in DB
- First registered user automatically becomes admin

**Frontend guard:** `authStore._hasHydrated` prevents render until Zustand persistence rehydrated; routes redirect to `/login` when `user` is null

## Error Handling

**Strategy:** Throw-and-catch with centralised error handler

**Patterns:**
- Route handlers throw `AppError(message, statusCode)` for expected errors (400, 401, 403, 404)
- Zod `parse()` throws `ZodError` on invalid input — caught by `errorHandler`, returns 400 with field-level details
- DB/service errors propagate via `next(error)` to `errorHandler`
- `errorHandler` returns `{ error: string }` JSON; never leaks stack traces in production
- Frontend: Axios interceptor dispatches `auth:unauthorized` on 401; component-level `try/catch` on async operations; `ErrorBoundary` component as last resort

## Cross-Cutting Concerns

**Logging:**
- Backend: Pino structured JSON, named category loggers (`dbLogger`, `parserFactoryLogger`, `securityLogger`, etc.)
- Rotating file streams: `app.log`, `error.log`, `http.log`, `parser*.log` in `data/logs/`
- Log level and debug mode configurable at runtime via `AdminSettings` in DB
- Frontend: custom `logger` wrapper in `frontend/src/lib/logger.ts` (wraps console, no production output)

**Validation:**
- Backend: Zod schemas in `backend/src/schemas/` for all user inputs; `validateEnv()` at startup
- Frontend: inline Zod validation in form components for client-side feedback

**API Key Encryption:**
- User and admin API keys (OpenAI, Claude, flight APIs) stored AES-encrypted in DB
- Encryption/decryption via `backend/src/utils/encryption.ts`; key from `ENCRYPTION_KEY` env var or secrets file

**i18n:**
- Frontend: `react-i18next`; namespace-per-feature resource files in `frontend/src/i18n/resources/`
- Custom `useTranslation` wrapper hook at `frontend/src/hooks/useTranslation.ts` (import this, not `react-i18next` directly)
- Language synced from `settingsStore.display.language` to i18n on change

---

*Architecture analysis: 2026-04-03*
