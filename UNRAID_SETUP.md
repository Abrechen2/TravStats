# TravStats - Unraid Installation (Kurz)

Fokus: Community Apps Template als Prod-Pfad. Du verwaltest die Abhaengigkeiten selbst: **PostGIS** ist Pflicht, **Ollama** optional. Standardmaessig laeuft die App nur im internen Netz; bei Bedarf kannst du sie ueber Nginx Proxy Manager + Cloudflare veroeffentlichen.

---

## ÐYZî Schnellstart

1. **PostGIS installieren**  
   - Community Apps → `postgis/postgis`  
   - Name `travstats-db`, Port `5432`, DB/User `flights`, eigenes Passwort  
   - Volume: `/mnt/user/appdata/travstats-db` → `/var/lib/postgresql/data`

2. **(Optional) Ollama installieren**  
   - Nur wenn LLM-Parser genutzt werden soll  
   - Community Apps → Ollama, Standard-Port 11434  
   - In TravStats `OLLAMA_URL` auf den Container setzen, `USE_LLM_PARSER=true`

3. **TravStats installieren**  
   - Community Apps → `TravStats` (oder Template-URL: `https://raw.githubusercontent.com/Abrechen2/TravStats/main/unraid-template.xml`)  
   - Wichtige Felder:  
     - WebUI Port: frei waehlbar (Standard 3000)  
     - `DATABASE_URL=postgresql://flights:<pw>@travstats-db:5432/flights`  
     - AppData: `/mnt/user/appdata/travstats`  
     - `SEED_AIRPORTS=true` lassen; `USE_LLM_PARSER` nur mit Ollama

4. **Setup-Wizard im LAN**  
   - `http://<unraid-ip>:3000/setup` → Instanzname + Admin anlegen  
   - Login: `http://<unraid-ip>:3000/login`

5. **Netzwerk**  
   - Standard: intern lassen (`http://<unraid-ip>:3000`)  
   - Optional extern: Nginx Proxy Manager + Cloudflare (DNS/Proxy/Tunnel) mit TLS; DB-Port bleibt intern.

---

## ÐY"õ Verwaltung
- Logs/Restart/Update ueber Unraid Docker Tab (TravStats, travstats-db, ggf. Ollama).
- DB-Check: `docker exec travstats-db pg_isready -U flights`.
- Health: TravStats-Container sollte nach ~1 Minute "Healthy" sein.

---

## ÐY"" Backup & Restore
- Backup DB:
  ```bash
  docker exec travstats-db pg_dump -U flights flights > /mnt/user/appdata/travstats/backups/backup-$(date +%Y%m%d).sql
  ```
- Backup Volumes: `/mnt/user/appdata/travstats/` und `/mnt/user/appdata/travstats-db/`.
- Restore: Container stoppen → SQL einspielen → Container starten.

---

## ÐY?> Troubleshooting
- **DB-Verbindung fehlgeschlagen:** Host `travstats-db`, Passwort/Port pruefen, PostGIS muss laufen.
- **Port belegt:** anderen WebUI-Port setzen (z.B. 3001).
- **Setup nicht sichtbar:** Setup nur einmalig; bei bestehendem User direkt `/login`.
- **Kein Ollama:** `USE_LLM_PARSER=false` setzen, Regex-Parser nutzt Standardpfad.

---

## ÐY"? Sicherheit
- PostGIS-Port nicht ins Internet exponieren.
- Prod: `ALLOW_REGISTRATION=false`, starke Passwoerter, regelmaessige Backups.
- Extern nur mit TLS via Nginx Proxy Manager + Cloudflare oder via VPN (WireGuard/Tailscale).

---

## ÐY'­ Nützlich
- Ressourcen prüfen: `docker stats travstats-app travstats-db`
- DB-Größe: `docker exec travstats-db psql -U flights -c "\l+ flights"`
- Admin-Export: `/admin` → "Export all data"

---

TravStats laeuft auf Unraid – viel Spass! ƒo^‹÷?ÐYO?
