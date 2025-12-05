# TravStats

Selbstgehostetes Flight-Tracking und Statistiken fuer kleine Gruppen (1-10 Accounts). Der Code ist offen, die Entwicklung liegt aktuell bei mir - Nutzer sollen die App hauptsaechlich per Docker installieren und nutzen.

## Ueberblick
- Self-hosted Full-Stack (PostgreSQL + Backend + Frontend) mit Invite-only-Setup.
- Kern-Features live: Flug-CRUD mit Kategorien/Tags/Kosten, interaktive Karte (GeoJSON), Zusammenfassungen (Fluege, Distanz, Flugzeit, Kosten, Top-Routen), Achievements + Leaderboard, Admin-Panel (User, Einladungen, Export), Boarding-Pass-Scan und E-Mail-Import.
- Open Source, aber keine externe Contributor-Prioritaet. Fokus: stabile Releases fuer Self-Hosting ueber Docker.

## Optionale Add-ons (per API-Key / Docker)
- **Automatische Flug-Suche**: `AIRLABS_API_KEY` (free tier) fuer Flight-Number-Lookup im Formular. Optional `AVIATIONSTACK_API_KEY` (mehr Abdeckung) und `OPENSKY_CLIENT_ID`/`OPENSKY_CLIENT_SECRET` oder `OPENSKY_USERNAME`/`OPENSKY_PASSWORD` als Fallback. Ohne Keys laeuft alles manuell.
- **E-Mail-Import mit KI**: Docker Compose startet zusaetzlich einen Ollama-Container. `USE_LLM_PARSER=true/false`, Modell ueber `OLLAMA_MODEL` (Standard: `llama3.2:3b`). Ohne LLM faellt der Parser auf Regex zurueck; wenn Ollama nicht gewuenscht ist, `USE_LLM_PARSER=false` setzen und den `ollama`-Service im Compose entfernen/auskommentieren. Erststart zieht das Modell (~1-2 GB).
- **Seeds & Demo**: `SEED_AIRPORTS=true` fuer Autocomplete-Datenbank, `CREATE_DEMO_USER=true` fuer Demo-Account mit Beispieldaten (nur Test).
- **Sicherheit & UI**: `ALLOW_REGISTRATION=false` (Invite-only), `MAX_USERS` Warnschwelle, `COOKIE_SECURE` je nach HTTPS, `INSTANCE_NAME` fuer Branding, `FRONTEND_URL` fuer korrekte Invite-Links.

## Schnellstart (Docker, empfohlen)
Voraussetzung: Docker + Docker Compose.

1) Repository holen  
```bash
git clone <repository-url>
cd TravStats
cp .env.prod.example .env
```

2) `.env` ausfuellen  
- Pflicht: `DB_PASSWORD` (starkes Passwort).  
- Optional: Instanzname, `ALLOW_REGISTRATION`, `MAX_USERS`, `COOKIE_SECURE`, `FRONTEND_URL`.  
- Optional fuer Add-ons: `AIRLABS_API_KEY`, `AVIATIONSTACK_API_KEY`, `OPENSKY_*`, `USE_LLM_PARSER`, `OLLAMA_MODEL`, `SEED_AIRPORTS`, `CREATE_DEMO_USER`.

3) Starten  
```bash
docker-compose -f docker-compose.prod.yml up -d
```
- Startet Postgres (mit PostGIS), App (Frontend+Backend) und optional Ollama.  
- Standard-Port: `APP_PORT=3000` (im .env anpassbar).

4) Setup-Wizard aufrufen  
`http://<host>:3000/setup` -> Admin-Account und Instanznamen anlegen.

5) Login & Admin  
- Login: `http://<host>:3000/login`  
- Admin-Panel: `/admin` (User aktivieren/deaktivieren, Einladungen, JSON-Export).

6) Updates / Wartung  
```bash
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d
# Stoppen: docker-compose -f docker-compose.prod.yml down
```

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
