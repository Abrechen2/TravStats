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
  - `docker-compose up -d`
  - `docker-compose exec backend npx prisma migrate deploy`
  - Optional Seeds: `npm run seed`, `npm run seed:airports:csv`, `npm run seed:achievements`
- Lokal:
  - Backend: `cd backend && npm install && cp .env.example .env && npx prisma generate && npx prisma migrate dev && npm run dev`
  - Frontend: `cd frontend && npm install && cp .env.example .env && npm run dev`

## Häufige Befehle
- Backend: `npm run dev` | `npm test` | `npx tsc --noEmit` | `npm run seed:*` | `npx prisma migrate dev/deploy/reset/generate`
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
- Uploads/Importe: POST `/uploads/receipts`, `/flight-lookup`, GET `/imports`

## Wenn du nachrüstest
- Neue Features: erst API/Schema planen, Migration + Zod-Schema + Tests; dann Frontend-API-Client und UI.
- Dokumentiere größere Änderungen hier kurz, halte Inhalt schlank.

Stand: bitte Datum im PR ergänzen, wenn wesentlich geändert.***
