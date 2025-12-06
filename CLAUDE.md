# CLAUDE.md – Kurzleitfaden für TravStats

Zweck: Schnelle Orientierung für KI-Helfer. Fokus auf kurze Antworten, bewahre bestehende Konventionen.

## Projekt in Kürze
- Selbstgehostete Flug-Tracking- und Analyse-Plattform für 1–10 Nutzer je Instanz.
- Datenhoheit und Privatsphäre stehen im Zentrum, keine Multi-Tenant-SaaS.
- Kernfunktionen: Flug-CRUD, Karten mit Routen, Achievements, Statistiken, CSV/GeoJSON/KML/PDF-Export, E-Mail-/Boardingpass-Import, umfangreiche Einstellungen.

## Tech-Stack
- Backend: Node.js 20+, TypeScript, Express, Prisma, PostgreSQL (+PostGIS), JWT, Zod, Jest.
- Frontend: React 18, TypeScript, Vite, React Router, Zustand, Tailwind CSS, React-Leaflet, Recharts.
- Infra: Docker + Docker Compose, Nginx (Frontend), Supervisor (Prod).

## Ordnerkarte (Monorepo)
- `backend/`
  - `src/routes` (API-Handler, dünn gehalten), `src/services` (Business-Logik), `src/schemas` (Zod), `src/middleware` (auth, rate-limit, upload), `src/utils` (Achievements, Geo, JWT, Logger), `src/db.ts` (Prisma Client).
  - `prisma/schema.prisma` + `prisma/migrations`.
  - `__tests__` für Integrations-/API-Tests.
  - Dockerfile, package.json, tsconfig, jest.config.
- `frontend/`
  - `src/components` (Map, FlightList, Forms, Scanner, Stats), `src/pages` (Login, Dashboard, Stats, Achievements, Import, Settings), `src/store` (auth/theme/settings), `src/lib/api.ts`, `src/types`.
  - Vite/Tailwind/tsconfig, Dockerfile, public assets.

## Schnellstart
- Docker (empfohlen):
  - `docker-compose up -d` (Initialisierung läuft automatisch)
  - Achievements werden automatisch geseedet
  - Optional: `SEED_AIRPORTS=true` für Flughafen-Datenbank
  - Optional: `CREATE_DEMO_USER=true` für Demo-User (demo/demo123)
- Lokal:
  - Backend: `cd backend && npm install && cp .env.example .env && npx prisma generate && npm run dev` (Initialisierung automatisch)
  - Frontend: `cd frontend && npm install && cp .env.example .env && npm run dev`
  - Tipp: `npm run init` für manuelle Initialisierung ohne Dev-Server Start

## Automatische Initialisierung

- Achievements werden **immer automatisch** geseedet (essentiell für das System)
- Im Dev-Modus läuft `npm run init` automatisch vor `npm run dev`
- Im Docker läuft die Initialisierung über `docker-entrypoint.sh`
- Alle Seeds sind idempotent (mehrfaches Ausführen ist sicher)

## Häufige Befehle

- Backend: `npm run dev` (inkl. auto-init) | `npm run init` (nur Initialisierung) | `npm test` | `npx tsc --noEmit`
- Seeds: `npm run seed:achievements` | `npm run seed:airports:csv` | `npm run seed:demo`
- Prisma: `npx prisma migrate dev/deploy/reset/generate` | `npx prisma studio`
- Frontend: `npm run dev` | `npm run build` (inkl. Typen) | `npm run lint`
- Docker: `docker-compose up -d` | `docker-compose down` | `docker-compose logs -f backend`

## Konventionen für Helfer
- Lies relevante Dateien vor Änderungen; halte dich an bestehende Muster.
- Typensicherheit bewahren; kein `any`, Prisma-Typen nutzen.
- Eingaben stets mit Zod validieren (Frontend + Backend).
- Controller dünn lassen, Logik in Services; Fehler zentral per Middleware.
- Auth prüfen (JWT in HttpOnly-Cookies), keine sensiblen Felder im Response.
- Nach Schema-Änderungen: Migration + `npx prisma generate`; ggf. Frontend-Typen anpassen.
- Tests hinzufügen/aktualisieren bei neuen Features; mindestens betroffene Routen/Komponenten.
- Keine Secrets committen; `.env` unangetastet lassen.
- Halte die Roadmap aktuell.


## Sicherheit Kurzfassung
- Auth: JWT in HttpOnly-Cookies (Fallback Bearer), Ablauf 7d.
- CORS: `CORS_ORIGIN` muss Frontend-URL matchen; Cookies benötigen `credentials=true`.
- Rate Limits auf Auth/Flights; passe Limits nur bewusst an.
- Uploads: Multer mit Dateigröße 5 MB, Typen: jpg/png/gif/pdf; Dateinamen werden gesichert.
- Produktion: HTTPS erzwingen, `Secure`-Cookies, starke `JWT_SECRET` (>=32 Zeichen), DB-Passwort setzen.

## Häufige Stolpersteine
- Prisma Client fehlt → `cd backend && npx prisma generate`
- Port belegt → `PORT` in `.env` ändern oder Prozess beenden.
- CORS/Cookies → Frontend `VITE_API_URL` und Backend `CORS_ORIGIN` abstimmen, `withCredentials` aktiv lassen.
- Map leer → Leaflet-CSS importieren, Koordinatenreihenfolge prüfen (lat, lon).
- TS-Fehler nach Schema-Änderung → `npx prisma generate`, Dev-Server neu starten.

## API-Kurzüberblick (Prefix `/api/v1`)
- Auth: POST `/auth/register`, `/auth/login`, `/auth/logout`, GET `/auth/me`
- Flights: CRUD `/flights`, GeoJSON `/flights/geo`
- Stats: GET `/stats/summary`, `/stats/routes`
- Airports: GET `/airports?query=...`
- Achievements: GET `/achievements`, `/achievements/user`, POST `/achievements/check`
- Settings: GET/PUT `/settings`
- Uploads: POST `/uploads/receipts`
- Parse: POST `/parse-email`, `/parse-boardingpass`, GET `/parse-boardingpass/check` (Ollama Vision)
- Flight Lookup: GET `/flight-lookup/:flightNumber?date=...`

## Import-Flow (Unified)

- **Email Import**: Im "Add Flight" Dialog als Option integriert
  - Upload: Drag & Drop (.eml/.txt/.msg) oder Text-Paste
  - Parse: Ollama LLM (Primary) mit Regex Fallback
  - Flow: Upload → Parse → Review (FlightReviewModal) → Confirm
  - Multi-Flight: Hin-/Rückflug werden nacheinander im Review Modal präsentiert
- **Boarding Pass**: Im "Add Flight" Dialog als Option integriert
  - Upload: Foto hochladen
  - Parse: Ollama Vision (Primary, Source of Truth) + optional API-Abgleich
  - Flow: Upload → Ollama Vision Parse → Optional API Enrichment → Review → Confirm
  - Kein DB-Zwischenspeicher mehr (altes ImportedFlight Model entfernt)

## Parser Provider System

TravStats nutzt ein flexibles Multi-Provider-System für Email- und Boarding Pass-Parsing. Jeder User kann seinen bevorzugten Parser wählen.

### Vision Parser (Boarding Pass)

- **Auto Mode** (Standard): Wählt automatisch besten verfügbaren Parser
- **Ollama Vision**: Lokal, kostenlos, benötigt GPU (~4-7GB Model)
- **OpenAI GPT-4 Vision**: Cloud, ~$0.01-0.05/Bild, sehr genau
- **Claude 3.5 Sonnet**: Cloud, ~$0.01-0.03/Bild, exzellent
- **Tesseract OCR**: Lokal, kostenlos, funktioniert ohne GPU
- **Manual**: OCR + manuelle Eingabe (Ultimate Fallback)

### Text Parser (Email)

- **Auto Mode** (Standard): Wählt automatisch besten verfügbaren Parser
- **Ollama**: Lokal, kostenlos, qwen2.5:7b empfohlen
- **OpenAI GPT-4**: Cloud, ~$0.002-0.01/Email
- **Claude 3.5**: Cloud, ~$0.003-0.015/Email
- **Regex**: Lokal, kostenlos, Pattern-basiert (Fallback)

### Konfiguration

- **ENV**: `VISION_PARSER`, `TEXT_PARSER`, `*_API_KEY` in `.env`
- **User Settings**: Jeder User kann Parser + Fallback Chain konfigurieren
- **Admin Settings**: Admin kann globale API Keys setzen + User-Permissions
- **Fallback Chain**: User-konfigurierbar, z.B. `ollama,openai,tesseract,manual`

## Enhanced Debug Logging (Admin)

TravStats verfügt über ein umfassendes Debug-Logging-System für Admins zur schnelleren Fehleranalyse.

### Aktivierung

- **API**: `POST /api/v1/admin/logging/toggle-debug` mit `{ "enabled": true }`
- **Persistenz**: Settings werden in AdminSettings-Tabelle gespeichert
- **Effekt**: Aktiviert debug/trace Log-Levels + detaillierte Instrumentation

### Log-Kategorien

- **HTTP**: Request/Response mit Timing, IP, User, Status (wenn `logHttpRequests` enabled)
- **Database**: SQL-Queries mit Args & Performance (wenn `logDatabaseQueries` enabled)
- **Parser**: LLM-Operations mit Provider-Details (wenn `logParserOperations` enabled)
- **Security**: Auth-Failures, Rate-Limits, Admin-Actions (immer aktiv)
- **Errors**: Alle Fehler mit Stack-Traces (in Debug-Mode)

### Log-Files

- **Location**: `/app/data/logs/` (Docker Volume `travstats-app-data`)
- **Format**: AI-freundliches strukturiertes JSON mit Kontext, Performance, Request-IDs
- **Rotation**: Täglich + größenbasiert (10MB default, konfigurierbar)
- **Retention**: 7 Tage default (konfigurierbar via AdminSettings)
- **Kategorien**: `app-*.log` (all logs), `error-*.log` (errors only)

### API Endpoints (Admin-only)

- **Config**:
  - `GET /admin/logging/config` - Logging-Konfiguration lesen
  - `PUT /admin/logging/config` - Config ändern (logLevel, maxLogFileSize, retention, etc.)
  - `POST /admin/logging/toggle-debug` - Debug-Mode schnell an/aus
- **Files**:
  - `GET /admin/logging/files` - Log-Files auflisten (mit Metadata: Size, Date, Category)
  - `GET /admin/logging/files/:filename` - Log lesen (mit Filters: level, category, search, offset, limit)
  - `GET /admin/logging/files/:filename/download` - Vollständiges Log downloaden
  - `DELETE /admin/logging/files/:filename` - Log-File löschen
- **Management**:
  - `GET /admin/logging/stats` - Statistiken (Total Size, File Count, Category Breakdown)
  - `POST /admin/logging/cleanup` - Alte Logs manuell löschen
  - `GET /admin/logging/search` - Logs durchsuchen (query, level, category, dateRange)

### AI-Optimiertes Format

Jeder Log-Entry enthält:

- `timestamp`: ISO 8601
- `level`: error/warn/info/debug/trace
- `category`: http/database/parser/security/error/system
- `message`: Kurzbeschreibung
- `context`: User, Provider, Operation, IP, etc.
- `performance`: Duration, Memory Delta
- `requestId`: Correlation ID für zusammenhängende Operationen
- `error`: Stack Trace, Message, Code (bei Fehlern)

**Beispiel-Log-Entry**:

```json
{
  "timestamp": "2025-12-06T14:32:15.234Z",
  "level": "debug",
  "category": "parser",
  "message": "Ollama Vision Parser parsing boarding pass",
  "context": {
    "userId": "uuid-xxx",
    "provider": "ollama",
    "model": "llava:latest",
    "operation": "boardingpass_parse"
  },
  "performance": {
    "duration": 1250,
    "memoryDelta": "2.34 MB"
  },
  "requestId": "req-abc12345"
}
```

### Performance

- **Async I/O**: Alle File-Operationen non-blocking
- **Conditional**: Nur wenn enabled (minimaler Overhead im Normalbetrieb)
- **Caching**: Config wird 5 Minuten gecached (reduziert DB-Load)
- **Redaction**: Sensitive Daten (Passwords, API Keys, Tokens) werden automatisch entfernt

### Für AI-Analyse optimiert

Die Logs sind so strukturiert, dass eine AI einfach:

- Fehlerursachen identifizieren kann (vollständiger Context)
- Performance-Probleme erkennt (Timing-Metriken in jedem Log)
- User-Flows nachvollziehen kann (Request Correlation IDs)
- Provider-Fehler debuggen kann (LLM Request/Response Details)

**Beispiel AI-Query**: "Analysiere app-2025-12-06.log und finde heraus warum Ollama Parser für User xyz fehlschlägt"

## Wenn du nachrüstest
- Neue Features: erst API/Schema planen, Migration + Zod-Schema + Tests; dann Frontend-API-Client und UI.
- Dokumentiere größere Änderungen hier kurz, halte Inhalt schlank.
- Alle wichtigen Infos in diesem Dokument aktualisieren.
- Alle Dokumente im Projekt aktuell halten (README, PRODUCTION_CHECKLIST, etc.).


