# TravStats - Unraid Installation Guide

Prod-Deployment zielt auf Unraid mit Community Apps. Die App laeuft als einzelner Container; **PostGIS** (Pflicht) und **Ollama** (optional) muessen vom Nutzer separat bereitgestellt werden. Standard-Betrieb ist im internen Netz, optional kannst du per Nginx Proxy Manager + Cloudflare veroeffentlichen.

---

## ÐY"< Prerequisites

- Unraid 6.9+ mit Community Applications Plugin
- Separater PostGIS-Container (`postgis/postgis`)
- Optional: Ollama-Container fuer KI-Parser (wenn verfgbar/gewollt)
- Mind. 2GB RAM, ~500MB Storage fuer App, DB-Storage je nach Daten

---

## ÐYs? Installation Steps

### Step 1: PostGIS Database bereitstellen
1. **Apps Tab** öffnen → nach `postgis` suchen → `postgis/postgis` installieren.
2. Empfohlene Werte:
   - Container Name: `travstats-db`
   - Port: `5432:5432`
   - POSTGRES_DB/USER: `flights`
   - POSTGRES_PASSWORD: eigenes starkes Passwort
   - Volume: `/mnt/user/appdata/travstats-db` → `/var/lib/postgresql/data`
3. Warten, bis der Container "Healthy" ist.

### (Optional) Step 1b: Ollama installieren
- Nur wenn `USE_LLM_PARSER=true` genutzt werden soll.
- Ollama aus Community Apps installieren, Standard-Port 11434 belassen.
- `OLLAMA_URL` in der TravStats-App auf den Container zeigen lassen.
- Wenn nicht verfuegbar: `USE_LLM_PARSER=false`, Parser faellt auf Regex/Standard zurueck.

### Step 2: TravStats installieren

**Option A: Community Apps (wenn veroeffentlicht)**
1. In Community Apps nach `TravStats` suchen.
2. Installieren, Einstellungen aus Tabelle unten setzen.

**Option B: Manuelles Template (bis CA-Release)**
1. Docker Tab → "Add Container".
2. Template URL einfuegen:
   ```
   https://raw.githubusercontent.com/Abrechen2/TravStats/main/unraid-template.xml
   ```
3. Einstellungen setzen wie unten beschrieben.

---

## ÐY"õ Configuration

**Pflichtfelder (App-Container):**

| Setting | Value / Beschreibung |
|---------|----------------------|
| WebUI Port | Freien Port waehlen (Standard 3000) |
| DATABASE_URL | `postgresql://flights:<PASSWORT>@travstats-db:5432/flights` |
| AppData | `/mnt/user/appdata/travstats` (persistenter Speicher) |

**Optionale Felder:**
- `SEED_AIRPORTS=true` (empfohlen, fuellt Airports beim Erststart)
- `USE_LLM_PARSER` + `OLLAMA_URL` falls Ollama genutzt wird
- API-Keys (`AIRLABS_API_KEY`, `OPENSKY_*`) fuer automatische Flugdaten
- Branding/Instanz: `INSTANCE_NAME`, `FRONTEND_URL`, `ALLOW_REGISTRATION`, `MAX_USERS`

---

## ÐYZî First Start & Setup
1. Container starten und Logs kurz pruefen (JWT/DB OK).
2. Setup-Wizard im LAN aufrufen:
   ```
   http://<unraid-ip>:3000/setup
   ```
3. Instanzname setzen, Admin-Account anlegen.
4. Login unter `http://<unraid-ip>:3000/login`.

---

## ÐYO? Access & Networking
- Standard: nur im internen Netz nutzen (`http://<unraid-ip>:3000`).
- Optional extern: ueber Nginx Proxy Manager + Cloudflare (DNS/Proxy/Tunnel) mit TLS veroeffentlichen. Nur die App exponieren, PostGIS bleibt intern.
- Keine Beispiel-Configs notwendig; achte auf korrektes `FRONTEND_URL`/`CORS_ORIGIN` bei Nutzung eines Proxys.

---

## ÐY"" Backup & Restore

### Backup
- DB-Dump:
  ```bash
  docker exec travstats-db pg_dump -U flights flights > travstats-backup-$(date +%Y%m%d).sql
  ```
- Volumes sichern: `/mnt/user/appdata/travstats/` (JWT/Configs) und `/mnt/user/appdata/travstats-db/` (DB).

### Restore
```bash
docker stop travstats-app travstats-db
cat travstats-backup-YYYYMMDD.sql | docker exec -i travstats-db psql -U flights flights
docker start travstats-db && docker start travstats-app
```

---

## ÐY?> Troubleshooting
- **"DATABASE_URL connection failed"**: Hostname `travstats-db`, Passwort/Port pruefen, PostGIS muss "Healthy" sein.
- **"Port already in use"**: anderen WebUI-Port waehlen (z.B. 3001).
- **Kein Zugriff aufs WebUI**: Container-Status/Logs pruefen, Port-Mapping verifizieren, Firewall checken.
- **Setup fehlt**: Setup nur einmalig; wenn bereits ein User existiert, direkt `/login` nutzen.

---

## ÐY"? Security Best Practices
- PostGIS-Port nicht ins Internet weiterleiten.
- App nur mit TLS publizieren (Nginx Proxy Manager + Cloudflare empfohlen) oder im LAN/VPN belassen.
- Starke Passwoerter fuer DB und Admin; `ALLOW_REGISTRATION=false` in Prod beibehalten.
- Regelmaessige Backups testen.

---

## ÐYÅT Updating TravStats
- Unraid Docker Tab → TravStats → Check for Updates / Force Update.
- PostGIS- und Ollama-Container separat aktuell halten.
- Migrationen laufen automatisch beim App-Start.

---

## ÐY'­ Tips & Monitoring
- Mobile: `http://<unraid-ip>:3000` aufrufen, ggf. "Add to Home Screen".
- Ressourcen pruefen: `docker stats travstats-app travstats-db`.
- DB-Groesse: `docker exec travstats-db psql -U flights -c "\l+ flights"`.

---

## ÐY"s Additional Resources
- GitHub Repository: https://github.com/Abrechen2/TravStats
- Issue Tracker: https://github.com/Abrechen2/TravStats/issues
- Full Docs: siehe README.md im Repository

---

## ÐYZ% Success!

TravStats laeuft auf Unraid! Standardmaessig im LAN, optional via Proxy/Cloudflare veroeffentlichen. Viel Spass beim Tracken! ƒo^‹÷?ÐYO?
