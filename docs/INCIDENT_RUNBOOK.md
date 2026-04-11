# TravStats — Incident Runbook

Step-by-step guide for production outages.

## 1. First Check (< 2 minutes)

```bash
# Health-Check
curl -s http://<SERVER_IP>:3000/api/v1/health

# Container-Status
ssh root@<SERVER_IP> "cd /opt/travstats && docker compose ps"

# Letzte Logs
ssh root@<SERVER_IP> "docker compose logs --tail=100 app"
```

## 2. Common Problems

### App does not start / returns 500

```bash
# Logs lesen
ssh root@<SERVER_IP> "docker compose logs app | grep -i error"

# Umgebungsvariablen prüfen (JWT_SECRET, DATABASE_URL)
ssh root@<SERVER_IP> "docker compose config app | grep -i env"

# Datenbankverbindung prüfen
ssh root@<SERVER_IP> "docker compose exec app npx prisma db status"
```

### Database not reachable

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

### Reload loop (Login → / → /login)

Cause: JWT cookie expired but the user is still in `auth-storage` localStorage.
Fix: `localStorage.removeItem('auth-storage')` in the browser console, then log in again.
Permanent fix: `authStore.ts` — `onRehydrateStorage` must not remove the event listener (already fixed in 0.9.1+).

## 3. Rollback

```bash
# Auf vorherige Version zurück
PREV_VERSION="0.9.0"
ssh root@<SERVER_IP> "cd /opt/travstats && \
  sed -i 's|travstats:.*|travstats:$PREV_VERSION|g' docker-compose.prod.yml && \
  docker compose pull && docker compose up -d"
```

## 4. After the Incident

- Record the root cause in `docs/LEARNINGS.md`
- If data was lost: backup restore via `scripts/backup.sh`
- Add CI tests that cover the weakness
