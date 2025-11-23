# TravStats - Flight Tracking & Analytics Platform

Eine umfassende Full-Stack-Anwendung zur Verfolgung, Visualisierung und Analyse Ihrer Flughistorie. Mit fortgeschrittenen Statistiken, Gamification-Elementen, CO2-Tracking und vielem mehr.

## ✨ Features

### 🎯 Kern-Funktionalitäten
- **Flugverwaltung**: Hinzufügen, Bearbeiten und Löschen von Flügen mit detaillierten Informationen
  - Airline, Flugnummer, Flugzeugtyp
  - Abflug-/Ankunftsflughäfen mit IATA/ICAO-Codes
  - Datum und Uhrzeiten
  - Sitzklasse, Sitznummer, Gate, Terminal
  - Boarding Pass Informationen
  - Kosten-Tracking (Preis, Währung, Steuern, Gebühren)
  - Kategorisierung (Geschäftlich/Privat/Urlaub)
  - Benutzerdefinierte Tags
- **Interaktive Karte**: Visualisierung aller Flüge auf einer Leaflet-Karte
  - Curved Arc Routes (Great Circle Paths)
  - Verschiedene Kartenansichten (OpenStreetMap, Satellite)
  - Farbcodierung nach Kategorie
  - Flughafen-Marker mit Details
- **Authentifizierung**: Sichere Benutzerauthentifizierung mit JWT
  - Passwort-Hashing mit bcrypt
  - Token-basierte Sessions
  - Geschützte API-Routen

### 📊 Statistiken & Analysen

#### Basis-Statistiken
- Gesamtflüge, Distanz, Flugzeit
- Breakdown nach Airline und Status
- Top-Routen-Analyse
- Häufigste Flughäfen

#### Erweiterte Statistiken
- **Distanz-Visualisierung**
  - Äquivalente (Erdumrundungen, Mond-Distanz)
  - Durchschnittliche Distanz pro Flug
  - Rangliste der längsten Strecken
- **Zeitbasierte Diagramme**
  - Flüge pro Monat/Jahr (Balkendiagramm)
  - Trend-Analyse (Liniendiagramm)
  - Saisonale Muster
  - Wochentags-Analyse
- **Kalender-Ansicht**
  - Monatskalender mit Flug-Markierungen
  - Jahresübersicht
  - Heatmap für Reiseintensität
- **CO2-Fußabdruck**
  - Berechnung pro Flug (nach Flugzeugtyp & Klasse)
  - Gesamt-CO2-Bilanz
  - Monatliche Trends
  - Kompensations-Vorschläge
- **Kosten-Tracking**
  - Gesamtausgaben Dashboard
  - Breakdown nach Airline/Route/Kategorie
  - Währungsumrechnung
- **Routen-Analyse**
  - Häufigste Routen
  - Route-Statistiken
  - Multi-Leg Reisen

### 🏆 Gamification

- **Achievement-System**
  - 20+ verschiedene Badges
  - Kategorien: Explorer, Distance, Collector, Social, Elite, Special
  - Tier-System: Bronze, Silver, Gold, Platinum, Diamond
  - Fortschritts-Tracking
  - Badge-Galerie
- **Flughafen-Collection**
  - Sammlung besuchter Flughäfen
  - Fortschritt zu Sammlungen
  - Seltene Flughäfen hervorheben
- **Vielflieger-Meilen Tracker**
  - Meilen-Berechnung pro Airline
  - Status-Level (Silver, Gold, Platinum)
  - Fortschritt zum nächsten Level

### ⚙️ Einstellungen & Personalisierung

- **Benutzer-Profil**: Benutzername, E-Mail, Profilbild, Passwort
- **Anzeige**: Dark/Light Mode, Sprache (DE/EN), Zeitzone, Datumsformat
- **Einheiten**: Distanz (km/mi/nm), Währung, Temperatur
- **Standard-Werte**: Flugstatus, Sitzklasse, Lieblings-Airline
- **Karten-Einstellungen**: Kartenansicht, Zoom-Level, Marker-Stil, Routenfarbe
- **Benachrichtigungen**: E-Mail, Flug-Erinnerungen, Check-in Reminder
- **Datenschutz**: 2FA, Login-Historie, Daten-Export (DSGVO)
- **Backup & Sync**: Automatische Backups, Cloud-Sync

### 📸 Import & Export

- **Boarding Pass Scanner**
  - QR/Barcode-Scanner
  - OCR für Text-Extraktion
  - PDF-Import von E-Tickets
  - Automatisches Ausfüllen des Formulars
- **Export-Funktionen**
  - CSV-Export
  - GeoJSON-Export
  - KML-Export für Google Earth
  - PDF-Report Generator
  - JSON Backup/Restore

### 🔍 Erweiterte Features

- **Smart Search**: Volltextsuche über alle Felder
- **Filter**: Nach Airline, Flugnummer, Datum, Status, Tags, Kategorien
- **Sitzplatz-Tracker**: Fenster vs. Gang Statistik, Präferenz-Empfehlungen
- **Trip-Zusammenfassung**: Mehrere Flüge zu Reisen gruppieren
- **Flugkarten-Generator**: Share-Grafiken, Jahresrückblick
- **Responsive Design**: Optimiert für Desktop, Tablet und Mobile

## 🛠️ Technologie-Stack

### Frontend
- **React 18** mit TypeScript
- **Vite** - Schneller Build-Tool
- **React Router** - Client-side Routing
- **Zustand** - State Management
- **Tailwind CSS** - Utility-first CSS
- **Leaflet & React-Leaflet** - Interaktive Karten
- **Recharts** - Datenvisualisierung
- **React Hook Form & Zod** - Formular-Validierung
- **date-fns** - Datum-Formatierung
- **Axios** - HTTP Client
- **@zxing/library** - Barcode/QR-Scanner

### Backend
- **Node.js 20** mit TypeScript
- **Express** - Web Framework
- **Prisma** - ORM mit Type-Safety
- **PostgreSQL 15** mit PostGIS - Datenbank mit Geo-Funktionen
- **JWT** - Authentifizierung
- **Bcrypt** - Passwort-Hashing
- **Zod** - Runtime Schema-Validierung
- **Helmet** - Security Headers
- **CORS** - Cross-Origin Resource Sharing
- **Rate-Limit** - API-Schutz
- **Jest & Supertest** - Testing

### DevOps
- **Docker & Docker Compose** - Containerisierung
- **Multi-stage Dockerfiles** - Optimierte Builds
- **Nginx** - Production Web Server
- **PostgreSQL with PostGIS** - Geospatial Database

## 📁 Projektstruktur

```
TravStats/
├── backend/              # Node.js/Express Backend
│   ├── prisma/          # Datenbank-Schema und Migrationen
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── src/
│   │   ├── __tests__/   # Test-Dateien
│   │   ├── middleware/  # Express Middleware (auth, errorHandler)
│   │   ├── routes/      # API Routes (auth, flights, stats, etc.)
│   │   ├── schemas/     # Zod Validierungs-Schemas
│   │   ├── services/    # Business Logic
│   │   ├── utils/       # Utility-Funktionen
│   │   ├── db.ts        # Prisma Client
│   │   ├── index.ts     # Main Server File
│   │   └── seed*.ts     # Datenbank-Seeding Skripte
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── frontend/            # React/Vite Frontend
│   ├── src/
│   │   ├── components/  # React Komponenten
│   │   ├── pages/       # Seiten-Komponenten
│   │   ├── lib/         # API Client & Utilities
│   │   ├── store/       # Zustand Stores
│   │   ├── types/       # TypeScript Types
│   │   ├── App.tsx      # Main App Component
│   │   ├── main.tsx     # Entry Point
│   │   └── index.css    # Global Styles
│   ├── public/          # Static Assets
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   └── vite.config.ts
├── docker-compose.yml   # Docker Compose Konfiguration
├── ROADMAP.md          # Feature Roadmap
├── PRODUCTION_CHECKLIST.md  # Production Deployment Checklist
└── README.md
```

## 🚀 Quick Start

### Voraussetzungen

- **Docker & Docker Compose** (empfohlen) ODER
- **Node.js 20+** und **PostgreSQL 15+** für lokale Entwicklung

### Mit Docker (Empfohlen)

1. **Repository klonen**
   ```bash
   git clone <repository-url>
   cd TravStats
   ```

2. **Alle Services starten**
   ```bash
   docker-compose up -d
   ```

   Dies startet:
   - PostgreSQL Datenbank auf Port 5432
   - Backend API auf Port 8000
   - Frontend auf Port 3000

3. **Datenbank initialisieren**
   ```bash
   # Migrationen ausführen
   docker-compose exec backend npx prisma migrate deploy

   # Optional: Sample-Daten einfügen
   docker-compose exec backend npm run seed
   docker-compose exec backend npm run seed:airports:csv
   docker-compose exec backend npm run seed:achievements
   ```

4. **Anwendung öffnen**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API Health: http://localhost:8000/health

5. **Demo-Account** (wenn Sample-Daten geladen)
   - Username: `demo`
   - Password: `demo123`

### Lokale Entwicklung (ohne Docker)

#### Backend Setup

```bash
cd backend

# Dependencies installieren
npm install

# Environment-Datei erstellen
cp .env.example .env

# .env anpassen: DATABASE_URL auf Ihre PostgreSQL-Instanz setzen
# Beispiel: postgresql://user:password@localhost:5432/travstats

# Prisma Client generieren
npx prisma generate

# Migrationen ausführen
npx prisma migrate dev

# Optional: Sample-Daten
npm run seed
npm run seed:airports:csv
npm run seed:achievements

# Development Server starten
npm run dev
```

#### Frontend Setup

```bash
cd frontend

# Dependencies installieren
npm install

# Environment-Datei erstellen
cp .env.example .env

# .env anpassen falls nötig
# VITE_API_URL=http://localhost:8000

# Development Server starten
npm run dev
```

## 🔧 Environment Variables

### Backend (.env)

```env
# Database
DATABASE_URL=postgresql://flights:password@localhost:5432/flights

# JWT - WICHTIG: In Production ändern!
JWT_SECRET=your-secret-key-change-in-production-MINIMUM-32-chars
JWT_EXPIRES_IN=7d

# Server
NODE_ENV=development
PORT=8000

# CORS
CORS_ORIGIN=http://localhost:3000
```

### Frontend (.env)

```env
VITE_API_URL=http://localhost:8000
```

## 📚 API-Dokumentation

### Basis-URL
```
http://localhost:8000/api/v1
```

### Authentifizierung

#### Register
```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "username": "string",
  "password": "string"
}
```

#### Login
```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "username": "string",
  "password": "string"
}
```

Antwort:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "username": "string"
  }
}
```

### Flüge (Authentifizierung erforderlich)

Alle Flight-Endpunkte erfordern `Authorization: Bearer <token>` Header.

#### Flüge abrufen
```http
GET /api/v1/flights
GET /api/v1/flights?airline=Lufthansa&status=flown&limit=50
GET /api/v1/flights/geo  # GeoJSON Format
```

#### Einzelnen Flug abrufen
```http
GET /api/v1/flights/:id
```

#### Flug erstellen
```http
POST /api/v1/flights
Content-Type: application/json

{
  "airline": "Lufthansa",
  "flightNumber": "LH123",
  "aircraft": "A320",
  "departure": {
    "icao": "EDDF",
    "iata": "FRA",
    "name": "Frankfurt Airport",
    "lat": 50.0379,
    "lon": 8.5622
  },
  "arrival": {
    "icao": "EGLL",
    "iata": "LHR",
    "name": "London Heathrow",
    "lat": 51.4700,
    "lon": -0.4543
  },
  "departureTime": "2025-11-20T08:00:00Z",
  "arrivalTime": "2025-11-20T09:30:00Z",
  "status": "flown",
  "seatClass": "economy",
  "category": "business",
  "price": 199.99,
  "currency": "EUR"
}
```

#### Flug aktualisieren
```http
PUT /api/v1/flights/:id
Content-Type: application/json

{
  "status": "flown",
  "notes": "Great flight!"
}
```

#### Flug löschen
```http
DELETE /api/v1/flights/:id
```

### Statistiken

#### Zusammenfassung
```http
GET /api/v1/stats/summary
GET /api/v1/stats/summary?fromDate=2025-01-01&toDate=2025-12-31
```

#### Top Routen
```http
GET /api/v1/stats/routes?limit=10
```

### Weitere Endpunkte

- `/api/v1/airports` - Flughafen-Suche
- `/api/v1/achievements` - Achievements & Badges
- `/api/v1/settings` - Benutzer-Einstellungen
- `/api/v1/analytics` - Analytics-Events

## 🗄️ Datenbank-Schema

### Wichtige Tabellen

- **users** - Benutzer mit Authentifizierung
- **flights** - Flugdaten mit Geo-Informationen
- **airports** - Flughafen-Datenbank (IATA/ICAO)
- **achievements** - Achievement-Definitionen
- **user_achievements** - Freigeschaltete Achievements
- **user_settings** - Benutzer-Einstellungen (JSON)
- **analytics_events** - Analytics-Tracking

Siehe [backend/prisma/schema.prisma](backend/prisma/schema.prisma) für Details.

## 🧪 Testing

### Backend Tests
```bash
cd backend
npm test              # Alle Tests
npm run test:watch    # Watch Mode
```

### Frontend Tests
```bash
cd frontend
npm test
```

## 📦 Production Deployment

### Wichtige Schritte

1. **Environment Variables setzen**
   - Starkes `JWT_SECRET` generieren: `openssl rand -hex 32`
   - Sichere `DATABASE_URL` mit starkem Passwort
   - `NODE_ENV=production`
   - `CORS_ORIGIN` auf echte Domain setzen

2. **SSL/HTTPS einrichten**
   - Let's Encrypt Zertifikat
   - HTTPS erzwingen
   - HSTS Header

3. **Docker Deployment**
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

4. **Reverse Proxy (Nginx/Apache)**
   - SSL-Termination
   - Gzip/Brotli Kompression
   - Static Asset Caching

5. **Monitoring einrichten**
   - Uptime Monitoring
   - Error Tracking (Sentry)
   - Performance Monitoring
   - Log Aggregation

6. **Backups automatisieren**
   - Datenbank-Backups (täglich)
   - Backup-Rotation
   - Offsite-Storage

📋 Siehe [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) für vollständige Checkliste!

## 🗺️ Feature Roadmap

Siehe [ROADMAP.md](ROADMAP.md) für geplante Features und Entwicklungsphasen.

**Status**: Die meisten Kern-Features sind implementiert! 🎉

Highlights:
- ✅ Kern-Visualisierungen (Distanz, Diagramme, Kalender)
- ✅ Gamification (Achievements, Collections, Meilen)
- ✅ Praktische Tools (Kosten, Tags, Einstellungen)
- ✅ Umwelt & Analysen (CO2, Routen, Heatmaps)
- ✅ Import & Export (Scanner, PDF, KML)

## 🤝 Contributing

1. Fork das Repository
2. Feature Branch erstellen (`git checkout -b feature/AmazingFeature`)
3. Änderungen committen (`git commit -m 'Add some AmazingFeature'`)
4. Branch pushen (`git push origin feature/AmazingFeature`)
5. Pull Request öffnen

### Development Guidelines

- TypeScript für Type-Safety verwenden
- Zod-Schemas für Validierung
- Tests für neue Features schreiben
- Code-Style mit ESLint/Prettier einhalten
- Sinnvolle Commit-Messages

## 📄 License

MIT License - siehe LICENSE-Datei für Details.

## 🙏 Acknowledgments

- OpenStreetMap für Kartendaten
- Leaflet für die Karten-Bibliothek
- OurAirports für Flughafen-Daten
- React & TypeScript Community

## 📧 Support & Kontakt

- **Issues**: GitHub Issues für Bug Reports und Feature Requests
- **Discussions**: GitHub Discussions für Fragen und Ideen

---

**Built with ❤️ using modern web technologies**

*Viel Spaß beim Tracken Ihrer Flüge!* ✈️

---

### 📊 Project Stats

- **Features**: 25+ implementiert
- **Lines of Code**: ~15,000+
- **Test Coverage**: 80%+
- **API Endpoints**: 30+
- **Database Tables**: 7
- **Supported Airports**: 7,000+

---

*Letzte Aktualisierung: 2025-11-22*
