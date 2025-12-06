# TravStats

Selbstgehostetes Flight-Tracking und Statistiken fuer kleine Gruppen (1-10 Accounts). Der Code ist offen, die Entwicklung liegt aktuell bei mir - Nutzer sollen die App hauptsaechlich per Docker installieren und nutzen.

## Ueberblick
- Self-hosted Full-Stack (PostgreSQL + PostGIS + Backend + Frontend) mit Invite-only-Setup.
- Kern-Features live: Flug-CRUD mit Kategorien/Tags/Kosten, interaktive Karte (GeoJSON), Zusammenfassungen (Fluege, Distanz, Flugzeit, Kosten, Top-Routen), Achievements + Leaderboard, Admin-Panel (User, Einladungen, Export), Boarding-Pass-Scan und E-Mail-Import.
- Open Source, aber keine externe Contributor-Prioritaet. Fokus: stabile Releases fuer Self-Hosting ueber Docker.

## Deployment-Fokus (Unraid)
- Prod-Ziel: Unraid Community Apps Template (TravStats) mit separater **PostGIS**-Datenbank (postgis/postgis) als Pflicht-Abhaengigkeit.
- Ollama ist optional (separater Container), die App faellt sonst auf Regex-/Standardparser zurueck.
- Standard-Betrieb im internen Netz; optional laesst sich die App via Nginx Proxy Manager + Cloudflare (DNS/Proxy/Tunnel) veroeffentlichen.
- Docker-Compose Dateien bleiben fuer lokale Tests/Dev nutzbar, aber Prod setzt auf Unraid-Container.

## Optionale Add-ons (per API-Key / Docker)
- **Automatische Flug-Suche**: `AIRLABS_API_KEY` (free tier) fuer Flight-Number-Lookup im Formular. Optional `AVIATIONSTACK_API_KEY` (mehr Abdeckung) und `OPENSKY_CLIENT_ID`/`OPENSKY_CLIENT_SECRET` oder `OPENSKY_USERNAME`/`OPENSKY_PASSWORD` als Fallback. Ohne Keys laeuft alles manuell.
- **E-Mail-Import mit KI**: Docker Compose startet zusaetzlich einen Ollama-Container. `USE_LLM_PARSER=true/false`, Modell ueber `OLLAMA_MODEL` (Standard: `llama3.2:3b`). Ohne LLM faellt der Parser auf Regex zurueck; wenn Ollama nicht gewuenscht ist, `USE_LLM_PARSER=false` setzen und den `ollama`-Service im Compose entfernen/auskommentieren. Erststart zieht das Modell (~1-2 GB).
- **Seeds & Demo**: `SEED_AIRPORTS=true` fuer Autocomplete-Datenbank, `CREATE_DEMO_USER=true` fuer Demo-Account mit Beispieldaten (nur Test).
- **Sicherheit & UI**: `ALLOW_REGISTRATION=false` (Invite-only), `MAX_USERS` Warnschwelle, `COOKIE_SECURE` je nach HTTPS, `INSTANCE_NAME` fuer Branding, `FRONTEND_URL` fuer korrekte Invite-Links.

## Schnellstart (Prod auf Unraid)
Voraussetzung: Unraid mit Community Apps.

1) In Community Apps **PostGIS-DB** installieren (`postgis/postgis`, z.B. Container `travstats-db`, Port 5432, DB/User `flights`, eigenes Passwort).  
2) Optional: **Ollama** als separaten Container installieren, falls KI-Parser genutzt werden soll (`USE_LLM_PARSER=true`, `OLLAMA_URL` auf Container zeigen).  
3) **TravStats** aus Community Apps installieren (Template `TravStats`), `DATABASE_URL` auf deine PostGIS-Instanz setzen, `SEED_AIRPORTS=true` lassen.  
4) Aufruf im LAN: `http://<unraid-ip>:3000/setup`, Admin anlegen.  
5) Extern nur falls gewuenscht: Per Nginx Proxy Manager + Cloudflare (DNS/Proxy/Tunnel) veroeffentlichen, ansonsten im internen Netz lassen.

## Alternative: Docker Compose (Tests/Dev)
- `docker-compose.prod.yml` enthaelt App + PostGIS + optional Ollama fuer nicht-Unraid-Setups.  
- `.env.prod.example` ausfuellen, dann `docker-compose -f docker-compose.prod.yml up -d` zum lokalen Testen.  
- Standard-Port: `APP_PORT=3000`.

## Daten & Sicherheit
- Daten liegen lokal in Docker-Volumes (`travstats-db-data`, `travstats-app-data`).  
- Backups: Datenbank-Volume sichern und/oder Admin-Export (`/admin` -> "Export all data").  
- Invite-only ist Standard (keine oeffentliche Registrierung). API-Calls fuer externe Dienste passieren nur bei genutzten Add-ons/Keys.

## Entwicklung (kurz)
Nur relevant, falls du lokal hacken willst. Die Docker-Images sind ansonsten fix & fertig.
- Backend: `cd backend && npm install && cp .env.example .env && npx prisma generate && npm run dev`
- Frontend: `cd frontend && npm install && cp .env.example .env && npm run dev`
- Tests: `cd backend && npm test`

## Lizenz
AGPL-3.0 (siehe `LICENSE`).

*Letzte Aktualisierung: 2025-12-05*
