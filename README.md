# ✈️ TravStats

Selbstgehostete Flight-Tracking und Statistiken-App für kleine Gruppen (1-10 Accounts). Tracke deine Flüge, visualisiere Routen auf interaktiven Karten und sammle Achievements.

## 🚀 Features

- **Flug-Tracking**: Erfasse Flüge mit Kategorien, Tags und Kosten
- **Interaktive Karten**: 2D/3D Visualisierung von Flugrouten und Airports
- **Statistiken**: Umfassende Analysen (Distanz, Flugzeit, Kosten, Top-Routen)
- **Achievements**: 58 Battlefield-Style Achievements in 5 Kategorien
- **Boarding-Pass Scanner**: QR-Code und Barcode-Scanning
- **E-Mail Import**: Automatischer Import von Flugbestätigungen (optional mit KI)
- **Export**: CSV, GeoJSON, KML (Google Earth)
- **Admin-Panel**: User-Verwaltung, Einladungen, Datenexport

## 📦 Installation mit Docker

### Voraussetzungen

- Docker & Docker Compose
- PostgreSQL 15 mit PostGIS Extension (separater Container)

### Schnellstart

1. **PostgreSQL/PostGIS Container starten:**
```bash
docker run -d \
  --name travstats-db \
  -e POSTGRES_DB=flights \
  -e POSTGRES_USER=flights \
  -e POSTGRES_PASSWORD=dein_sicheres_passwort \
  -v travstats-db-data:/var/lib/postgresql/data \
  postgis/postgis:15-3.4
```

2. **TravStats Container starten:**
```bash
docker run -d \
  --name travstats-app \
  -p 3000:80 \
  -e DATABASE_URL=postgresql://flights:dein_sicheres_passwort@travstats-db:5432/flights \
  -e SEED_AIRPORTS=true \
  -v travstats-app-data:/app/data \
  --link travstats-db:db \
  abrechen2/travstats:latest
```

3. **App öffnen:**
   - Navigiere zu `http://localhost:3000/setup`
   - Erstelle deinen Admin-Account
   - Starte mit dem Tracking!

### Docker Compose (empfohlen)

```bash
# .env Datei erstellen
cp .env.prod.example .env

# Passwörter und Optionen anpassen
nano .env

# Container starten
docker-compose -f docker-compose.prod.yml up -d
```

## 🐳 Docker Hub

Das Image ist verfügbar auf Docker Hub:
```
abrechen2/travstats:latest
```

## ⚙️ Konfiguration

### Wichtige Umgebungsvariablen

| Variable | Beschreibung | Standard |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL Verbindungsstring | **Erforderlich** |
| `SEED_AIRPORTS` | Airport-Datenbank beim Start füllen | `true` |
| `ALLOW_REGISTRATION` | Öffentliche Registrierung erlauben | `false` |
| `MAX_USERS` | Maximale Anzahl Benutzer | `10` |
| `INSTANCE_NAME` | Name der Instanz | `TravStats` |
| `OLLAMA_URL` | Ollama Service URL | `http://localhost:11434` |
| `OLLAMA_MODEL` | Basis-Modell für Email-Parsing | `qwen2.5:7b` |
| `OLLAMA_VISION_MODEL` | Basis-Modell für Vision-Parsing | `llama3.2-vision` |
| `TRAINING_MODEL_OUTPUT_DIR` | Speicherort für trainierte Modelle | `./data/training/models` |
| `TRAINING_EMAIL_MODEL_NAME` | Name für trainiertes Email-Modell | `travstats-email-custom` |
| `TRAINING_VISION_MODEL_NAME` | Name für trainiertes Vision-Modell | `travstats-vision-custom` |

### Optionale API-Keys

- **AirLabs API Key**: Automatische Flugdaten-Suche (Free Tier: 1000 req/month)
  - `AIRLABS_API_KEY=dein_key`
- **OpenSky Network**: Fallback für Flugdaten
  - `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET`

### KI-Parser (Ollama)

Für KI-gestützten E-Mail-Import:

1. Ollama Container installieren:
```bash
docker run -d --name ollama -v ollama-data:/root/.ollama ollama/ollama:latest
```

2. Umgebungsvariablen setzen:
```bash
OLLAMA_URL=http://ollama:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_VISION_MODEL=llama3.2-vision

# Training-Konfiguration (optional, kann auch in Admin-UI gesetzt werden)
TRAINING_MODEL_OUTPUT_DIR=./data/training/models
TRAINING_EMAIL_MODEL_NAME=travstats-email-custom
TRAINING_VISION_MODEL_NAME=travstats-vision-custom
```

## 📖 Verwendung

1. **Ersten Flug erfassen**: Dashboard → "Neuer Flug"
2. **Boarding-Pass scannen**: Upload-Funktion nutzen
3. **Statistiken ansehen**: Dashboard & Stats-Seite
4. **Achievements freischalten**: Automatisch beim Erreichen von Meilensteinen
5. **Daten exportieren**: Admin-Panel → Export

## 🔒 Sicherheit

- **Invite-only**: Standardmäßig keine öffentliche Registrierung
- **JWT-Authentifizierung**: Automatisch generierte sichere Secrets
- **Rate Limiting**: Schutz vor Missbrauch
- **Lokale Daten**: Alle Daten bleiben auf deinem Server

## 🛠️ Entwicklung

```bash
# Backend
cd backend
npm install
cp .env.example .env
npx prisma generate
npm run dev

# Frontend
cd frontend
npm install
cp .env.example .env
npm run dev
```

## 📝 Lizenz

AGPL-3.0 - Siehe [LICENSE](LICENSE)

## 🔗 Links

- **Docker Hub**: [abrechen2/travstats](https://hub.docker.com/r/abrechen2/travstats)
- **Issues**: [GitHub Issues](https://github.com/Abrechen2/TravStats/issues)

---

**Made with ❤️ for flight enthusiasts**
