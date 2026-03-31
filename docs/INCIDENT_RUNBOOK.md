# TravStats — Incident Runbook

Schritt-für-Schritt bei Produktionsausfällen.

## 1. Erster Check (< 2 Minuten)

```bash
# Health-Check
curl -s http://<SERVER_IP>:3000/api/v1/health

# Container-Status
ssh root@<SERVER_IP> "cd /opt/travstats && docker compose ps"

# Letzte Logs
ssh root@<SERVER_IP> "docker compose logs --tail=100 app"
```

## 2. Häufige Probleme

### App startet nicht / gibt 500 zurück

```bash
# Logs lesen
ssh root@<SERVER_IP> "docker compose logs app | grep -i error"

# Umgebungsvariablen prüfen (JWT_SECRET, DATABASE_URL)
ssh root@<SERVER_IP> "docker compose config app | grep -i env"

# Datenbankverbindung prüfen
ssh root@<SERVER_IP> "docker compose exec app npx prisma db status"
```

### Datenbank nicht erreichbar

```bash
# Postgres-Container läuft?
ssh root@<SERVER_IP> "docker compose ps db"

# Healthcheck-Log
ssh root@<SERVER_IP> "docker inspect --format='{{json .State.Health}}' travstats_db_1"
```

### Disk Full

```bash
# Alte Docker-Images aufräumen
ssh root@<SERVER_IP> "docker system prune -af --volumes"

# Log-Größen prüfen
ssh root@<SERVER_IP> "du -sh /opt/travstats/data/logs/*"
```

### Reload-Loop (Login → / → /login)

Ursache: JWT-Cookie abgelaufen aber User noch in `auth-storage` localStorage.
Fix: `localStorage.removeItem('auth-storage')` in der Browser-Konsole, dann neu einloggen.
Dauerhafter Fix: `authStore.ts` — `onRehydrateStorage` darf Event-Listener nicht entfernen (bereits gefixt ab 0.9.1).

## 3. Rollback

```bash
# Auf vorherige Version zurück
PREV_VERSION="0.9.0"
ssh root@<SERVER_IP> "cd /opt/travstats && \
  sed -i 's|travstats:.*|travstats:$PREV_VERSION|g' docker-compose.prod.yml && \
  docker compose pull && docker compose up -d"
```

## 4. Nach Incident

- Root Cause in `docs/LEARNINGS.md` festhalten
- Wenn Datenverlust: Backup-Restore via `scripts/backup.sh`
- CI-Tests ergänzen die Schwachstelle abdecken
