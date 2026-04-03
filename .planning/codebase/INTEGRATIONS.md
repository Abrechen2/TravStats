# External Integrations

**Analysis Date:** 2026-04-03

## APIs & External Services

**LLM Providers (for email/boarding pass parsing):**

- **OpenAI** — Text and vision parsing of booking emails and boarding pass images
  - SDK/Client: `openai ^6.33.0`
  - Auth: `OPENAI_API_KEY` env var (global from `admin_settings.global_openai_api_key` or per-user `user_settings.openai_api_key`, AES-256-GCM encrypted in DB)
  - Models: `OPENAI_MODEL` / `OPENAI_VISION_MODEL` env vars, defaults to gpt-4o class
  - Parsers: `backend/src/services/parsers/text/openaiTextParser.ts`, `backend/src/services/parsers/vision/openaiVisionParser.ts`

- **Anthropic Claude** — Text and vision parsing of booking emails and boarding pass images
  - SDK/Client: `@anthropic-ai/sdk ^0.80.0`
  - Auth: `CLAUDE_API_KEY` env var (global or per-user, encrypted in DB)
  - Models: `CLAUDE_MODEL` / `CLAUDE_VISION_MODEL` env vars
  - Parsers: `backend/src/services/parsers/text/claudeTextParser.ts`, `backend/src/services/parsers/vision/claudeVisionParser.ts`

- **Ollama (self-hosted)** — Local LLM inference, free alternative to cloud LLMs
  - SDK/Client: `axios` (REST API calls to Ollama HTTP endpoint)
  - Auth: None (unauthenticated local endpoint)
  - Connection: `OLLAMA_URL` env var (default `http://localhost:11434`; production typically `http://192.168.178.155:11434`)
  - Models: `OLLAMA_MODEL` / `OLLAMA_VISION_MODEL` env vars (default `llama3.2-vision`)
  - Parsers: `backend/src/services/parsers/text/ollamaTextParser.ts`, `backend/src/services/parsers/vision/ollamaVisionParser.ts`, `backend/src/services/ollamaVisionParser.ts`

**Flight Data APIs (for flight enrichment and live updates):**

- **AirLabs** — Flight schedule and status lookup (free tier, cached)
  - SDK/Client: `axios`
  - Auth: `AIRLABS_API_KEY` env var (global or per-user, encrypted in DB)
  - Usage: `backend/src/services/flightLookup.ts`

- **Aviationstack** — Flight schedule and status lookup (alternative/fallback)
  - SDK/Client: `axios`
  - Auth: `AVIATIONSTACK_API_KEY` env var (global or per-user, encrypted in DB)
  - Usage: `backend/src/services/flightLookup.ts`

- **OpenSky Network** — Free open-source flight tracking data
  - SDK/Client: `axios`
  - Auth: `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` / `OPENSKY_USERNAME` / `OPENSKY_PASSWORD` env vars (per-user supported, encrypted in DB)
  - Usage: `backend/src/services/flightLookup.ts`

## Data Storage

**Databases:**
- **PostgreSQL with PostGIS 3.4** — Primary data store
  - Connection: `DATABASE_URL` env var (PostgreSQL connection string), or individual `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` vars
  - Client: Prisma 5.7 (`@prisma/client`), schema in `backend/prisma/schema.prisma`
  - PostGIS extension enabled (declared via `postgresqlExtensions` preview feature)
  - CI uses `postgis/postgis:15-3.4` Docker image
  - Migrations managed via `npx prisma migrate dev` / `npx prisma migrate deploy`

**File Storage:**
- Local filesystem — Uploaded files, log files, backup archives
  - Upload storage: `backend/uploads/` (managed by `multer ^2.1.1`)
  - Log files: `data/logs/` (app.log, error.log, http.log, parser*.log)
  - Backup archives: `BACKUP_PATH` env var (default `/app/data/backups`)
  - Persistent in production via Docker volume mount at `/app/data`

**Caching:**
- In-memory only — `node-cache ^5.1.2` for airport lookups and external API responses
  - Usage: `backend/src/services/airportCache.ts`
  - No external cache service (Redis not used)

## Authentication & Identity

**Auth Provider:**
- Custom (no third-party auth service)
  - Password hashing: `bcrypt ^5.1.1` (`backend/src/utils/password.ts`)
  - Token: JWT (`jsonwebtoken ^9.0.3`) stored as HttpOnly cookie
  - JWT secret: `JWT_SECRET` env var or auto-generated secret stored in `/app/secrets/jwt.secret` file (`backend/src/utils/jwtSecret.ts`)
  - Token expiry: `JWT_EXPIRES_IN` env var (default `7d`)
  - Encryption key for API keys: `ENCRYPTION_KEY` env var (64-char hex) — AES-256-GCM, PBKDF2 key derivation (`backend/src/utils/encryption.ts`)
  - Invitation-only registration by default (`ALLOW_REGISTRATION=false`)

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry or similar)

**Logs:**
- Pino structured JSON — `backend/src/utils/logger.ts`
- Rotating file streams via `rotating-file-stream ^3.2.9`
  - Files: `data/logs/app.log`, `data/logs/error.log`, `data/logs/http.log`, `data/logs/parser*.log`
  - Rotation: daily + size-based (configurable via `AdminSettings`)
  - Retention: configurable via `AdminSettings.logRetentionDays` (default 7 days)
  - Verbosity: `LOG_LEVEL` env var or runtime toggle via admin UI

**Health Check:**
- `GET /health` — returns `{ status, version, timestamp }`

## CI/CD & Deployment

**Hosting:**
- Self-hosted — Proxmox LXC container CT 100 running Docker (`192.168.178.120`)
- Container: `ghcr.io/abrechen2/travstats` (GHCR)

**CI Pipeline:**
- GitHub Actions
  - `ci.yml` — Runs on push to Main/DEV and PRs to Main: backend lint + typecheck + Jest tests (with PostGIS service container), frontend lint + typecheck + Prettier check + Vitest coverage, Python ruff + bandit security scan
  - `release.yml` — Triggered on `v*.*.*` tags: validates `backend/VERSION` matches tag, runs CI, builds multi-arch Docker image (amd64 + arm64) and pushes to GHCR, creates GitHub Release with CHANGELOG notes
  - `docker-build.yml` — Separate workflow (PR trigger removed to avoid timeouts)
  - `claude.yml`, `claude-code-review.yml` — Claude AI integration workflows

**Deployment Flow:**
- Local Docker build → push to GHCR → SSH via pve-node3 → `docker compose pull && docker compose up -d` on CT 100
- Docker Compose file: `/opt/travstats/docker-compose.yml` on server
- Container process management: supervisord (nginx + Node.js)

## Backup & Sync

**Backup:**
- Internal backup service — `backend/src/services/backupService.ts`
  - Archives to ZIP using `archiver ^7.0.1`
  - Backup records stored in `backups` table (Prisma model)
  - Scheduled via `node-cron` (`backend/src/services/backupScheduler.ts`)
  - Optional: `pg_dump` database export via `DOCKER_DB_CONTAINER` env var

**WebDAV Sync (optional):**
- For offsite backup storage
  - SDK/Client: `webdav ^5.9.0`
  - Auth: `WEBDAV_URL`, `WEBDAV_USERNAME`, `WEBDAV_PASSWORD` env vars
  - Enable: `WEBDAV_SYNC_ENABLED=true` env var
  - Target path: `WEBDAV_BACKUP_PATH` env var (default `/TravStats/backups/`)
  - Implementation: `backend/src/services/cloudSyncService.ts`

## Email

**Outgoing Email (Flight Reminders):**
- Nodemailer ^8.0.4 — SMTP email delivery
  - Config stored in DB (`SmtpConfig` Prisma model, `smtp_config` table)
  - Managed via admin UI, enabled/disabled via `SmtpConfig.enabled`
  - Sends 24h and 2h pre-departure flight reminders
  - Implementation: `backend/src/services/emailService.ts`, `backend/src/services/reminderScheduler.ts`

**Incoming Email Parsing (boarding pass extraction):**
- `@kenjiuno/msgreader ^1.28.0` — Parse Outlook `.msg` files uploaded by users
- `cheerio ^1.2.0` — Parse HTML email bodies for flight data extraction
- `node-html-parser ^7.1.0` — Lightweight HTML parsing fallback
- Implementation: `backend/src/services/emailExtractor.ts`, `backend/src/services/bookingParser.ts`

## OCR & Document Processing

**Tesseract OCR:**
- `tesseract.js ^6.0.1` — Used both backend and frontend for boarding pass image OCR
  - Backend: `backend/src/services/boardingPassParser.ts`
  - Frontend: `frontend/src/lib/boardingPassOCR.ts`

**PDF Processing:**
- `pdf-parse ^2.4.5` — Extract text from PDF boarding passes
  - Backend: `backend/src/services/pdfParser.ts`

**Barcode/QR (Frontend only):**
- `@zxing/browser ^0.1.5` + `@zxing/library ^0.21.0` — Camera-based QR/barcode scanning
- `jsqr ^1.4.0` — QR code decoding from images
- Implementation: `frontend/src/lib/barcodeExtractor.ts`, `frontend/src/lib/bcbpParser.ts`

## Webhooks & Callbacks

**Incoming:** None

**Outgoing:** None (all integrations are pull-based, initiated by the backend)

## Environment Configuration

**Required env vars:**
- `JWT_SECRET` (min 32 chars) — or auto-generated to `/app/secrets/jwt.secret`
- `DATABASE_URL` or `DB_HOST` + `DB_PORT` + `DB_NAME` + `DB_USER` + `DB_PASSWORD`

**Optional env vars (external integrations):**
- `OPENAI_API_KEY` — OpenAI LLM parsing
- `CLAUDE_API_KEY` — Anthropic Claude LLM parsing
- `OLLAMA_URL` — Self-hosted Ollama endpoint
- `AIRLABS_API_KEY` — AirLabs flight data
- `AVIATIONSTACK_API_KEY` — Aviationstack flight data
- `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` / `OPENSKY_USERNAME` / `OPENSKY_PASSWORD`
- `WEBDAV_URL` / `WEBDAV_USERNAME` / `WEBDAV_PASSWORD` / `WEBDAV_BACKUP_PATH`
- `ENCRYPTION_KEY` (64-char hex) — Encrypt API keys stored in DB
- `CORS_ORIGIN` — Enable cross-origin requests (disabled in production by default)

**Secrets location:**
- `.env` file at `backend/.env` (gitignored)
- JWT secret file at `/app/secrets/jwt.secret` (Docker volume, not committed)
- API keys persisted in DB encrypted via AES-256-GCM (`backend/src/utils/encryption.ts`)

---

*Integration audit: 2026-04-03*
