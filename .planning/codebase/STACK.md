# Technology Stack

**Analysis Date:** 2026-04-03

## Languages

**Primary:**
- TypeScript 5.3.x - Backend (Express) and Frontend (React/Vite), strict mode enforced
- Python 3.x - ML training scripts only (`backend/src/scripts/trainLora.py`, `checkHardware.py`, etc.)

**Secondary:**
- SQL (PostgreSQL dialect) - managed exclusively through Prisma ORM, never written directly

## Runtime

**Environment:**
- Node.js 20.x (LTS) — pinned in `Dockerfile` (`FROM node:20-alpine`), `actions/setup-node@v6` in CI

**Package Manager:**
- npm — backend lockfile: `backend/package-lock.json`, frontend lockfile: `frontend/package-lock.json`
- Lockfile: present (both sides)

## Frameworks

**Core — Backend:**
- Express ^4.18.2 — HTTP API server, port 8000 in dev (`backend/src/index.ts`)
- Prisma ^5.7.0 — ORM, migrations, Prisma Client JS (`backend/prisma/schema.prisma`)

**Core — Frontend:**
- React ^18.2.0 — UI framework
- React Router DOM ^6.30.3 — Client-side routing (`frontend/src/App.tsx`)
- Vite ^6.4.1 — Dev server (port 3000) and production bundler

**Validation:**
- Zod ^3.22.4 — Schema validation on both backend (all user inputs, `backend/src/schemas/`) and frontend forms

**State Management:**
- Zustand ^4.5.7 — Global state (`frontend/src/store/`: `authStore.ts`, `settingsStore.ts`, `themeStore.ts`, `toastStore.ts`)

**Styling:**
- Tailwind CSS ^3.4.0 — Utility-first CSS
- PostCSS ^8.4.32, Autoprefixer ^10.4.16

**Internationalisation:**
- react-i18next ^14.0.0 — i18n with custom hook wrapper (`frontend/src/hooks/useTranslation.ts`)
- i18next ^23.7.16
- Translations in: `frontend/src/i18n/` (de/en namespaces)

**Animation:**
- Framer Motion ^12.34.3 — Page transitions and UI animations

**Testing — Backend:**
- Jest ^29.7.0 + ts-jest ^29.4.6 — Unit/integration tests
- Supertest ^6.3.3 — HTTP integration tests

**Testing — Frontend:**
- Vitest ^4.0.15 — Unit/component tests
- @testing-library/react ^14.1.2 — React component testing
- @testing-library/user-event ^14.5.1
- @testing-library/jest-dom ^6.1.5
- jsdom ^23.0.1 — Browser environment simulation
- @vitest/coverage-v8 ^4.0.18 — Coverage

**Build/Dev:**
- tsx ^4.21.0 — TypeScript execution for dev server (`npm run dev`)
- ts-node ^10.9.2 — TypeScript REPL/scripts

## Key Dependencies

**Security (Backend):**
- helmet ^7.1.0 — Security HTTP headers + CSP (`backend/src/index.ts`)
- express-rate-limit ^7.1.5 — Rate limiting on `/api/` routes
- bcrypt ^5.1.1 — Password hashing
- jsonwebtoken ^9.0.3 — JWT auth (HttpOnly cookie transport, never localStorage)
- cookie-parser ^1.4.7 — Cookie parsing for JWT extraction
- Node.js `crypto` (built-in) — AES-256-GCM encryption for API keys in DB

**Logging (Backend):**
- pino ^9.6.0 — Structured JSON logger (`backend/src/utils/logger.ts`)
- rotating-file-stream ^3.2.9 — Daily rotating log files in `data/logs/`
- pino-pretty ^13.1.3 — Dev console formatting

**Data Processing (Backend):**
- cheerio ^1.2.0 — HTML email parsing
- node-html-parser ^7.1.0 — Lightweight HTML parsing
- pdf-parse ^2.4.5 — PDF boarding pass extraction
- tesseract.js ^6.0.1 — OCR for image boarding passes (both backend and frontend)
- @kenjiuno/msgreader ^1.28.0 — Parse Outlook `.msg` email files
- csv-parse ^6.2.1 — Airport CSV seeding
- date-fns-tz ^3.2.0 — Timezone-aware date manipulation (backend)
- date-fns ^3.0.6 — Date utilities (frontend)
- uuid ^13.0.0 — UUID generation
- archiver ^7.0.1 — ZIP backup creation

**HTTP Client:**
- axios ^1.14.0 (backend), ^1.13.5 (frontend) — All HTTP requests including external API calls
- `withCredentials: true` required on all frontend Axios instances

**Caching:**
- node-cache ^5.1.2 — In-memory cache for airport lookups and API responses
- node-cron ^3.0.3 — Scheduled jobs (backup, flight updates, reminders)

**Mapping & Visualisation (Frontend):**
- deck.gl ^9.2.11 (+ @deck.gl/layers, @deck.gl/aggregation-layers, @deck.gl/react) — 3D flight visualisation
- react-map-gl ^8.1.0 — MapLibre React wrapper
- maplibre-gl ^5.19.0 — Base map renderer
- react-globe.gl ^2.37.0 — Globe mode
- three ^0.181.2 — WebGL 3D (used by react-globe.gl)
- @turf/turf ^6.5.0 — Geospatial calculations (great circle routes, etc.)
- recharts ^3.4.1 — Charts and statistics visualisations

**Barcode/QR (Frontend):**
- @zxing/browser ^0.1.5, @zxing/library ^0.21.0 — QR/barcode reader for boarding passes
- jsqr ^1.4.0 — Pure JS QR decoder

**Forms (Frontend):**
- react-hook-form ^7.49.2
- @hookform/resolvers ^3.3.3 — Zod resolver

**Export (Frontend):**
- jspdf ^4.1.0, jspdf-autotable ^5.0.7 — PDF export for flight certificate and year report

**ML Training (Python, in Docker only):**
- PyTorch (CPU build) — Model training base
- transformers >=4.35.0, peft >=0.6.0 — LoRA fine-tuning
- datasets >=2.14.0, accelerate >=0.24.0, bitsandbytes >=0.41.0

## Configuration

**Environment:**
- `.env` file in `backend/` (gitignored) — loaded by `dotenv ^16.3.1` at startup
- Validated at startup via Zod schema in `backend/src/config/env.ts`
- Required keys: `DATABASE_URL` (or `DB_*` components), `JWT_SECRET` (≥32 chars)
- Optional keys: `CORS_ORIGIN`, `OPENAI_API_KEY`, `CLAUDE_API_KEY`, `OLLAMA_URL`, `AIRLABS_API_KEY`, `AVIATIONSTACK_API_KEY`, `OPENSKY_*`, `WEBDAV_*`, `ENCRYPTION_KEY`

**Build:**
- Backend: `tsconfig.json` — `strict: true`, compiles to `backend/dist/`
- Frontend: `tsconfig.json` — `strict: true`; Vite config in `frontend/vite.config.ts`
- ESLint configs: `backend/.eslintrc.*`, `frontend/eslint.config.*`
- Prettier: `frontend/.prettierrc` (printWidth 100, singleQuote false)

## Platform Requirements

**Development:**
- Node.js 20.x, npm
- PostgreSQL with PostGIS extension (for local backend tests)
- Optional: Ollama running locally at `http://localhost:11434` for LLM parsing

**Production:**
- Docker container (`node:20-slim` + nginx + supervisor)
- Nginx serves frontend static files and reverse-proxies `/api/` to Node backend on port 8000
- Supervisor manages nginx + Node processes
- External PostgreSQL with PostGIS 3.4 (separate container or managed DB)
- Registry: GHCR (`ghcr.io/abrechen2/travstats`), multi-arch (amd64 + arm64)
- Health check endpoint: `GET /health`

---

*Stack analysis: 2026-04-03*
