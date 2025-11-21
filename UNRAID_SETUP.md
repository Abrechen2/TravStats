# TravStats - Unraid Installation (Vereinfacht)

Diese Anleitung zeigt, wie du TravStats auf Unraid installierst - **nur 2 Container** statt 3!

## 🎯 Schnellstart-Übersicht

**Was du installierst:**
1. **PostgreSQL-Container** (Datenbank)
2. **TravStats-Container** (Frontend + Backend in einem!)

**Gesamtdauer:** Ca. 10-15 Minuten

---

## 📦 Installation über Community Apps (Empfohlen)

### Voraussetzungen

- Unraid 6.9+
- Community Apps Plugin installiert
- Docker aktiviert

### Schritt 1: PostgreSQL Database installieren

1. **Community Apps** öffnen
2. Nach **"PostgreSQL"** suchen
3. Template auswählen: **"postgis/postgis"** (mit PostGIS Extension!)
4. Konfigurieren:

| Einstellung | Wert |
|-------------|------|
| **Name** | `travstats-db` |
| **Port** | `5432` |
| **POSTGRES_DB** | `flights` |
| **POSTGRES_USER** | `flights` |
| **POSTGRES_PASSWORD** | `dein-sicheres-passwort` ⚠️ |
| **Appdata Pfad** | `/mnt/user/appdata/travstats-db` |

5. **Apply** klicken und starten

### Schritt 2: TravStats installieren

1. **Community Apps** öffnen
2. Nach **"TravStats"** suchen
3. Konfigurieren:

| Einstellung | Wert | Beschreibung |
|-------------|------|--------------|
| **Port** | `3000` | Web-Interface Port |
| **Database Password** | `dein-passwort` | ⚠️ Gleich wie in travstats-db! |
| **SEED_AIRPORTS** | `true` | Flughäfen-DB automatisch füllen ✅ |
| **AppData** | `/mnt/user/appdata/travstats` | Für persistent Daten |

**✨ So einfach ist es jetzt:**
- Nur **ein Passwort** eingeben (das gleiche wie beim DB-Container)
- Alles andere läuft automatisch im Hintergrund
- Kein JWT_SECRET, keine komplizierte DATABASE_URL mehr nötig!

4. **Apply** klicken

**Fertig!** 🎉

Öffne im Browser: `http://[UNRAID-IP]:3000`

---

## 🛠️ Manuelle Installation (ohne Community Apps)

Falls TravStats noch nicht im Community Apps Store ist, installiere manuell:

### Option A: Mit Docker Compose

**1. Vorbereitung:**

```bash
# Via SSH auf Unraid
mkdir -p /mnt/user/appdata/travstats
cd /mnt/user/appdata/travstats

# Dateien hochladen via SMB oder git clone
# Benötigt: docker-compose.production.yml und .env
```

**2. .env Datei erstellen:**

```bash
cat > .env <<EOF
DB_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
APP_PORT=3000
SEED_AIRPORTS=true
EOF
```

**3. Images bauen:**

```bash
# Image bauen (einmalig)
docker build -t travstats:latest .
```

**4. Container starten:**

```bash
docker-compose -f docker-compose.production.yml up -d
```

### Option B: Einzelne Container (Unraid Web-UI)

#### Container 1: Datenbank

**Docker Tab** → **Add Container**

| Feld | Wert |
|------|------|
| **Name** | `travstats-db` |
| **Repository** | `postgis/postgis:15-3.4` |
| **Network** | `bridge` |
| **Port** | `5432:5432` |

**Umgebungsvariablen:**
- `POSTGRES_DB=flights`
- `POSTGRES_USER=flights`
- `POSTGRES_PASSWORD=your-password`

**Volume Mapping:**
- Container: `/var/lib/postgresql/data`
- Host: `/mnt/user/appdata/travstats/db`

#### Container 2: TravStats App

**Docker Tab** → **Add Container**

| Feld | Wert |
|------|------|
| **Name** | `travstats-app` |
| **Repository** | `travstats:latest` |
| **Network** | `bridge` |
| **Port** | `3000:80` |

**Umgebungsvariablen (vereinfacht!):**
- `DB_PASSWORD=your-password` (⚠️ gleich wie in DB-Container!)
- `DB_HOST=localhost` (bei --network=container) oder `travstats-db` (bei --link)
- `SEED_AIRPORTS=true`

**Volume Mapping:**
- Container: `/app/data`
- Host: `/mnt/user/appdata/travstats`

**Extra Parameters:**
```
--network=container:travstats-db
```

**💡 Tipp:** Alle anderen DB-Settings (Port, User, DB-Name) haben sinnvolle Defaults und müssen nicht gesetzt werden!

**Apply** klicken!

---

## 🚀 Erste Schritte

### 1. Zugriff auf die Anwendung

Öffne im Browser:
```
http://[DEINE-UNRAID-IP]:3000
```

### 2. Account erstellen

1. Klicke auf **"Register"**
2. Erstelle deinen Account:
   - **Username:** dein-name
   - **Password:** sicheres Passwort
3. Nach Registrierung automatisch eingeloggt

### 3. Ersten Flug hinzufügen

1. **Dashboard** → **"Add Flight"**
2. Flugdaten eingeben:
   - Abflughafen (z.B. FRA)
   - Zielflughafen (z.B. JFK)
   - Datum & Zeit
   - Optional: Flugnummer, Airline, etc.
3. **Save** klicken

Der Flug erscheint auf der Karte! 🗺️

---

## 🔧 Verwaltung

### Container-Status prüfen

```bash
# Via SSH auf Unraid
docker ps | grep travstats
```

### Logs anzeigen

```bash
# TravStats App Logs
docker logs -f travstats-app

# Datenbank Logs
docker logs -f travstats-db
```

### Container neu starten

**Unraid Web-UI:**
1. **Docker** Tab
2. Container auswählen
3. **Restart** klicken

**Via SSH:**
```bash
docker restart travstats-app travstats-db
```

### Container stoppen

```bash
docker stop travstats-app travstats-db
```

### Container starten

```bash
docker start travstats-db
sleep 5
docker start travstats-app
```

---

## 💾 Backup & Wiederherstellung

### Automatisches Backup (empfohlen)

**User Scripts Plugin verwenden:**

1. **Plugins** → **User Scripts** installieren
2. Neues Script erstellen: **"TravStats Backup"**
3. Script-Inhalt:

```bash
#!/bin/bash
BACKUP_DIR="/mnt/user/appdata/travstats/backups"
DATE=$(date +%Y%m%d_%H%M%S)

# Backup erstellen
docker exec travstats-db pg_dump -U flights flights | gzip > "${BACKUP_DIR}/backup-${DATE}.sql.gz"

# Alte Backups löschen (älter als 30 Tage)
find "${BACKUP_DIR}" -name "backup-*.sql.gz" -mtime +30 -delete

echo "✅ Backup erstellt: backup-${DATE}.sql.gz"
```

4. **Schedule:** Daily - `0 3 * * *` (täglich um 3 Uhr)

### Manuelles Backup

```bash
# Via SSH
docker exec travstats-db pg_dump -U flights flights > /mnt/user/appdata/travstats/backups/backup.sql

# Komprimieren
gzip /mnt/user/appdata/travstats/backups/backup.sql
```

### Backup wiederherstellen

```bash
# Backup entpacken
gunzip /mnt/user/appdata/travstats/backups/backup-20250121.sql.gz

# Datenbank wiederherstellen
cat /mnt/user/appdata/travstats/backups/backup-20250121.sql | \
  docker exec -i travstats-db psql -U flights flights
```

---

## 🔐 Sicherheit

### Checkliste

- [ ] **Starke Passwörter verwenden**
  - Mindestens 16 Zeichen
  - Zufällig generiert

- [ ] **JWT_SECRET ändern**
  - Niemals Standard-Wert verwenden
  - Neu generieren: `openssl rand -hex 32`

- [ ] **Database Password ändern**
  - In beiden Containern (DB + App)
  - In DATABASE_URL anpassen

- [ ] **Reverse Proxy einrichten (optional)**
  - Nginx Proxy Manager oder Traefik
  - Let's Encrypt SSL-Zertifikat

- [ ] **Regelmäßige Backups**
  - Automatisches Daily Backup aktivieren
  - Backups testen!

- [ ] **Updates einspielen**
  - Images regelmäßig aktualisieren
  - Release Notes beachten

### Reverse Proxy Setup (HTTPS)

**Mit Nginx Proxy Manager:**

1. **Nginx Proxy Manager** aus Community Apps installieren
2. Proxy Host erstellen:
   - **Domain:** `travstats.deine-domain.de`
   - **Forward Hostname:** `travstats-app`
   - **Forward Port:** `80`
   - **SSL:** Let's Encrypt aktivieren
   - **Websockets Support:** aktivieren

---

## ❓ Fehlerbehebung

### Problem: Container startet nicht

**Symptom:** Container bleibt im Stopped-Status

**Lösung:**
```bash
# Logs prüfen
docker logs travstats-app

# Häufige Ursachen:
# 1. Datenbank nicht erreichbar
docker logs travstats-db

# 2. DATABASE_URL falsch
docker exec travstats-app env | grep DATABASE

# 3. Port bereits belegt
netstat -tulpn | grep 3000
```

### Problem: "Cannot connect to database"

**Symptom:** App zeigt Datenbankfehler

**Lösung:**
```bash
# 1. Prüfe ob DB-Container läuft
docker ps | grep travstats-db

# 2. Teste Verbindung
docker exec travstats-db psql -U flights -c "SELECT 1;"

# 3. Prüfe DATABASE_URL
# Stelle sicher, dass Hostname 'travstats-db' oder 'db' ist (mit --link)

# 4. Container-Link prüfen
docker inspect travstats-app | grep Links
```

### Problem: Seite lädt nicht / 404 Error

**Symptom:** Webseite zeigt Fehler

**Lösung:**
```bash
# 1. Prüfe ob Container läuft
docker ps | grep travstats-app

# 2. Prüfe Port-Mapping
docker port travstats-app

# 3. Teste lokalen Zugriff
curl http://localhost:3000

# 4. Firewall prüfen
iptables -L | grep 3000
```

### Problem: Flughäfen nicht in Datenbank

**Symptom:** Autocomplete zeigt keine Flughäfen

**Lösung:**
```bash
# Flughäfen manuell nachladen
docker exec -it travstats-app sh -c "cd /app/backend && npm run seed:airports:csv"

# Oder Container neu starten mit SEED_AIRPORTS=true
```

### Problem: Migrations-Fehler

**Symptom:** "Table does not exist" Fehler

**Lösung:**
```bash
# Migrationen manuell ausführen
docker exec -it travstats-app sh -c "cd /app/backend && npx prisma migrate deploy"
```

---

## 🔄 Updates

### App-Container aktualisieren

```bash
# 1. Neues Image bauen
cd /mnt/user/appdata/travstats
docker build -t travstats:latest .

# 2. Container stoppen und entfernen
docker stop travstats-app
docker rm travstats-app

# 3. Container neu erstellen (über Unraid Web-UI oder docker run)
docker-compose -f docker-compose.production.yml up -d
```

**In Unraid Web-UI:**
1. **Docker** Tab → **travstats-app**
2. **Force Update** (falls Image-Tag gleich)
3. **Apply**

---

## 📊 Ressourcen & Monitoring

### Ressourcen-Limits setzen

**In Unraid Web-UI:** Container Edit → Advanced View

```
Extra Parameters:
--memory="512m" --cpus="1.0"
```

### Monitoring

```bash
# Container-Ressourcen live
docker stats travstats-app travstats-db

# Disk Usage
du -sh /mnt/user/appdata/travstats/*

# Datenbank-Größe
docker exec travstats-db psql -U flights -c "\l+ flights"
```

---

## 🌐 Externen Zugriff einrichten

### Option 1: Cloudflare Tunnel (kostenlos & sicher)

1. **Cloudflared** aus Community Apps installieren
2. Tunnel konfigurieren:
   - **URL:** `http://travstats-app:80`
   - **Public Hostname:** `travstats.deine-domain.de`

### Option 2: VPN (Wireguard)

1. **Wireguard** aus Community Apps installieren
2. Peer konfigurieren
3. Von unterwegs per VPN verbinden

### Option 3: Port Forwarding (nicht empfohlen)

**Nur mit HTTPS/Reverse Proxy!**

Router-Port `443` auf Unraid-IP:`443` weiterleiten

---

## 📚 Weitere Informationen

### Hilfreiche Befehle

```bash
# Alle TravStats Container anzeigen
docker ps -a | grep travstats

# Container-Informationen
docker inspect travstats-app

# In Container-Shell gehen
docker exec -it travstats-app sh

# Prisma Studio (Datenbank-GUI)
docker exec -it travstats-app sh -c "cd /app/backend && npx prisma studio"
# Dann: http://[UNRAID-IP]:5555

# PostgreSQL-Kommandozeile
docker exec -it travstats-db psql -U flights flights
```

### Nützliche SQL-Queries

```sql
-- In PostgreSQL-Kommandozeile (siehe oben)

-- Alle Benutzer anzeigen
SELECT id, username, created_at FROM users;

-- Anzahl Flüge pro Benutzer
SELECT u.username, COUNT(f.id) as flight_count
FROM users u
LEFT JOIN flights f ON u.id = f.user_id
GROUP BY u.username;

-- Alle Flughäfen mit Anzahl Besuchen
SELECT dep_iata, dep_name, COUNT(*) as visits
FROM flights
WHERE dep_iata IS NOT NULL
GROUP BY dep_iata, dep_name
ORDER BY visits DESC;
```

### Projektstruktur im Container

```
/app/
├── backend/
│   ├── dist/           # Kompiliertes Backend (Node.js)
│   ├── prisma/         # Datenbank-Schema & Migrationen
│   └── node_modules/
└── frontend/
    └── dist/           # Kompiliertes Frontend (HTML/JS/CSS)
```

### Links

- **GitHub:** [Projektseite]
- **Docker Hub:** [Container Registry]
- **Unraid Forums:** [Support Thread]

---

## 🎉 Fertig!

Du hast TravStats erfolgreich auf Unraid installiert!

**Next Steps:**
1. Account erstellen
2. Erste Flüge hinzufügen
3. Achievements freischalten
4. Backup einrichten

**Viel Spaß beim Tracken deiner Flüge! ✈️🗺️**

---

## 📝 Changelog

| Version | Datum | Änderungen |
|---------|-------|------------|
| 2.0.0 | 2025-01-21 | Vereinfachte Version (2 Container statt 3) |
| 1.0.0 | 2025-01-21 | Initiale Version |
