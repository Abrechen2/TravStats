# TravStats

Flight tracker — Express/TypeScript backend + React/Vite/TypeScript frontend.

## Dev Commands

```bash
# Alles installieren
npm run install:all

# Backend + Frontend gleichzeitig starten
npm run dev           # oder: scripts/dev-all.sh

# Einzeln
npm run dev:backend   # Port 8000
npm run dev:frontend  # Port 3000
```

## Build-Checks (PFLICHT vor jedem PR/Commit)

```bash
# Backend
cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit

# Frontend
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

## Docker & Deployment

Deployment-Details (Server-IP, SSH-Befehle, Compose-Pfade) → **`CLAUDE.local.md`** (gitignored, lokal anlegen).

```bash
# Lokal bauen (Docker Desktop muss laufen)
VERSION=$(cat backend/VERSION)
bash scripts/docker-build.sh   # oder: scripts/docker-build.ps1

# Versionierung: backend/VERSION erhöhen → commit → Tag pushen
echo "0.9.1" > backend/VERSION
git add backend/VERSION && git commit -m "chore: bump version to 0.9.1"
git tag v0.9.1 && git push origin v0.9.1   # startet release.yml
```

## Commit-Anforderung

**Jede Änderung muss vor Session-Ende committed sein.**

## PR Workflow (KRITISCH)

1. **Kein Merge ohne grünes CI.** Vor jedem Merge: `gh pr checks <number>` — alle Checks grün. Kein `--admin`-Bypass.
2. **Immer Änderungen zeigen vor Merge.** Zusammenfassung präsentieren, explizite Bestätigung abwarten, bevor nach `Main` gemergt oder in Prod deployed wird.

## Architektur

```
backend/src/
  index.ts          # Express App Entry
  routes/           # Route-Handler — eine Datei pro Domain
  middleware/        # auth, rateLimit, error
  services/          # Business Logic
  schemas/           # Zod Validation Schemas
  utils/             # Helper (logger, password, etc.)
  db.ts              # Prisma Client Singleton

frontend/src/
  pages/             # Route-Level Komponenten
  components/        # Wiederverwendbare UI-Komponenten
  store/             # Zustand State Stores
  lib/               # API Client (api.ts), Logger
  hooks/             # Custom React Hooks
  i18n/              # react-i18next Übersetzungen (de/en)
```

## Kritische Gotchas

- **`any` ist VERBOTEN** — immer `unknown` + Type Guards. Ausnahme: `.d.ts`-Dateien.
- **Pino Logger** — kein `console.log`. Import: `import { logger } from '../utils/logger'`
- **Prisma JSON-Felder** — `as unknown as Prisma.InputJsonValue` casten, nie direkt `Record<string, unknown>`
- **deck.gl + MapLibre** — `MapboxOverlay` + `useControl` Pattern verwenden (NICHT `<DeckGL>` React-Komponente — WebGL-Konflikt mit MapLibre 5.x)
- **GeoJSON-Koordinaten** — kommen aus `geometry.coordinates` (LineString), NICHT aus `departureAirport.lat/lon` (nicht befüllt)
- **Auth Cookie** — JWT ist HttpOnly Cookie (kein Bearer-Token). `withCredentials: true` in allen Axios-Instanzen.
- **Prisma Migrations** — Schema-Änderungen immer mit `npx prisma migrate dev` (nie manuell)
- **React Hooks** — `useTranslation` aus `'../hooks/useTranslation'` (eigener Wrapper), nicht direkt aus `react-i18next`
- **Zod** — Pflicht für alle User-Inputs und API-Requests. Schema liegt in `backend/src/schemas/`

## Code Style

- TypeScript: `strict: true`, ESLint + Prettier (printWidth 100, singleQuote false)
- Async: immer `async/await`, kein `.then()`
- Immutabilität: Spread `{...obj, field: value}`, kein In-Place-Mutation
- Fehlerbehandlung: Explizit auf jeder Ebene, kein Silent Swallow
- Dateigrößen: 200–400 Zeilen ideal, **800 Zeilen Maximum**

## Version

Source of Truth: `backend/VERSION` (aktuell: `0.9.0-beta`)

Neuen Release erstellen:
1. `backend/VERSION` auf neue Version setzen
2. `CHANGELOG.md` aktualisieren (Unreleased → neuer Abschnitt)
3. Committen + Tag `v{VERSION}` pushen → `release.yml` startet automatisch

Script für Vorschlag: `scripts/suggest-next-version.sh` / `.ps1`

## Security

- Alle User-Inputs via **Zod-Schema** validieren (System-Boundaries)
- Rate Limiting auf allen Auth- und teuren Endpoints (express-rate-limit)
- Keine Hardcoded Secrets — `.env`-Datei (gitignored), im Container via Secrets-Volume
- JWT in HttpOnly Cookie (kein localStorage)
- XSS: React escaped automatisch; kein `dangerouslySetInnerHTML`
- SQL Injection: Prisma ORM (parametrisierte Queries)
- Security-Scan: `scripts/security-scan.sh`

Security-Befunde: `PENTEST_FINDINGS.md` (falls vorhanden)

## Testing

```bash
# Frontend (Vitest, kein DB nötig)
cd frontend && npx vitest --run

# Backend (Jest, benötigt PostgreSQL)
cd backend && npm test -- --forceExit

# E2E (Playwright, benötigt laufenden Dev-Server)
npx playwright test

# Alles auf einmal
bash scripts/run-tests.sh   # oder: scripts/run-tests.ps1
```

## Monitoring & Logs

- Logs in `data/logs/` (app.log, error.log, http.log, parser*.log)
- Pino structured JSON — `LOG_LEVEL` Env-Var steuert Verbosity
- Gesundheits-Check: `GET /api/v1/health`

## Maschinen-spezifische Infos

→ Siehe **`CLAUDE.local.md`** für: Server-IP (Underworld), SSH-Pfade, Docker-Compose-Pfade, lokale Port-Mappings.
