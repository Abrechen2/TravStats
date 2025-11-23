# TravStats - Flight Tracking & Analytics Platform

Eine umfassende Full-Stack-Anwendung zur Verfolgung, Visualisierung und Analyse Ihrer Flughistorie. Mit fortgeschrittenen Statistiken, Gamification-Elementen, CO2-Tracking und vielem mehr.
## Schnelltest (Build-Smoketest)
- Backend: cd backend && npm install && npm run build
- Frontend: cd frontend && npm install && npm run build
- Dev (lokal): cd backend && npm install && npm run dev in einem Terminal, cd frontend && npm install && npm run dev im zweiten; API läuft auf Port 8000, Vite auf 3000.


## Ô£¿ Features

### ­ƒÄ» Kern-Funktionalit+ñten
- **Flugverwaltung**: Hinzuf++gen, Bearbeiten und L+Âschen von Fl++gen mit detaillierten Informationen
  - Airline, Flugnummer, Flugzeugtyp
  - Abflug-/Ankunftsflugh+ñfen mit IATA/ICAO-Codes
  - Datum und Uhrzeiten
  - Sitzklasse, Sitznummer, Gate, Terminal
  - Boarding Pass Informationen
  - Kosten-Tracking (Preis, W+ñhrung, Steuern, Geb++hren)
  - Kategorisierung (Gesch+ñftlich/Privat/Urlaub)
  - Benutzerdefinierte Tags
- **Interaktive Karte**: Visualisierung aller Fl++ge auf einer Leaflet-Karte
  - Curved Arc Routes (Great Circle Paths)
  - Verschiedene Kartenansichten (OpenStreetMap, Satellite)
  - Farbcodierung nach Kategorie
  - Flughafen-Marker mit Details
- **Authentifizierung**: Sichere Benutzerauthentifizierung mit JWT
  - Passwort-Hashing mit bcrypt
  - Token-basierte Sessions
  - Gesch++tzte API-Routen

### ­ƒôè Statistiken & Analysen

#### Basis-Statistiken
- Gesamtfl++ge, Distanz, Flugzeit
- Breakdown nach Airline und Status
- Top-Routen-Analyse
- H+ñufigste Flugh+ñfen

#### Erweiterte Statistiken
- **Distanz-Visualisierung**
  - +äquivalente (Erdumrundungen, Mond-Distanz)
  - Durchschnittliche Distanz pro Flug
  - Rangliste der l+ñngsten Strecken
- **Zeitbasierte Diagramme**
  - Fl++ge pro Monat/Jahr (Balkendiagramm)
  - Trend-Analyse (Liniendiagramm)
  - Saisonale Muster
  - Wochentags-Analyse
- **Kalender-Ansicht**
  - Monatskalender mit Flug-Markierungen
  - Jahres++bersicht
  - Heatmap f++r Reiseintensit+ñt
- **CO2-Fu+ƒabdruck**
  - Berechnung pro Flug (nach Flugzeugtyp & Klasse)
  - Gesamt-CO2-Bilanz
  - Monatliche Trends
  - Kompensations-Vorschl+ñge
- **Kosten-Tracking**
  - Gesamtausgaben Dashboard
  - Breakdown nach Airline/Route/Kategorie
  - W+ñhrungsumrechnung
- **Routen-Analyse**
  - H+ñufigste Routen
  - Route-Statistiken
  - Multi-Leg Reisen

### ­ƒÅå Gamification

- **Achievement-System**
  - 20+ verschiedene Badges
  - Kategorien: Explorer, Distance, Collector, Social, Elite, Special
  - Tier-System: Bronze, Silver, Gold, Platinum, Diamond
  - Fortschritts-Tracking
  - Badge-Galerie
- **Flughafen-Collection**
  - Sammlung besuchter Flugh+ñfen
  - Fortschritt zu Sammlungen
  - Seltene Flugh+ñfen hervorheben
- **Vielflieger-Meilen Tracker**
  - Meilen-Berechnung pro Airline
  - Status-Level (Silver, Gold, Platinum)
  - Fortschritt zum n+ñchsten Level

### ÔÜÖ´©Å Einstellungen & Personalisierung

- **Benutzer-Profil**: Benutzername, E-Mail, Profilbild, Passwort
- **Anzeige**: Dark/Light Mode, Sprache (DE/EN), Zeitzone, Datumsformat
- **Einheiten**: Distanz (km/mi/nm), W+ñhrung, Temperatur
- **Standard-Werte**: Flugstatus, Sitzklasse, Lieblings-Airline
- **Karten-Einstellungen**: Kartenansicht, Zoom-Level, Marker-Stil, Routenfarbe
- **Benachrichtigungen**: E-Mail, Flug-Erinnerungen, Check-in Reminder
- **Datenschutz**: 2FA, Login-Historie, Daten-Export (DSGVO)
- **Backup & Sync**: Automatische Backups, Cloud-Sync

### ­ƒô© Import & Export

- **Boarding Pass Scanner**
  - QR/Barcode-Scanner
  - OCR f++r Text-Extraktion
  - PDF-Import von E-Tickets
  - Automatisches Ausf++llen des Formulars
- **Export-Funktionen**
  - CSV-Export
  - GeoJSON-Export
  - KML-Export f++r Google Earth
  - PDF-Report Generator
  - JSON Backup/Restore

### ­ƒöì Erweiterte Features

- **Smart Search**: Volltextsuche ++ber alle Felder
- **Filter**: Nach Airline, Flugnummer, Datum, Status, Tags, Kategorien
- **Sitzplatz-Tracker**: Fenster vs. Gang Statistik, Pr+ñferenz-Empfehlungen
- **Trip-Zusammenfassung**: Mehrere Fl++ge zu Reisen gruppieren
- **Flugkarten-Generator**: Share-Grafiken, Jahresr++ckblick
- **Responsive Design**: Optimiert f++r Desktop, Tablet und Mobile

## ­ƒøá´©Å Technologie-Stack

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

## ­ƒôü Projektstruktur

```
TravStats/
Ôö£ÔöÇÔöÇ backend/              # Node.js/Express Backend
Ôöé   Ôö£ÔöÇÔöÇ prisma/          # Datenbank-Schema und Migrationen
Ôöé   Ôöé   Ôö£ÔöÇÔöÇ schema.prisma
Ôöé   Ôöé   ÔööÔöÇÔöÇ migrations/
Ôöé   Ôö£ÔöÇÔöÇ src/
Ôöé   Ôöé   Ôö£ÔöÇÔöÇ __tests__/   # Test-Dateien
Ôöé   Ôöé   Ôö£ÔöÇÔöÇ middleware/  # Express Middleware (auth, errorHandler)
Ôöé   Ôöé   Ôö£ÔöÇÔöÇ routes/      # API Routes (auth, flights, stats, etc.)
Ôöé   Ôöé   Ôö£ÔöÇÔöÇ schemas/     # Zod Validierungs-Schemas
Ôöé   Ôöé   Ôö£ÔöÇÔöÇ services/    # Business Logic
Ôöé   Ôöé   Ôö£ÔöÇÔöÇ utils/       # Utility-Funktionen
Ôöé   Ôöé   Ôö£ÔöÇÔöÇ db.ts        # Prisma Client
Ôöé   Ôöé   Ôö£ÔöÇÔöÇ index.ts     # Main Server File
Ôöé   Ôöé   ÔööÔöÇÔöÇ seed*.ts     # Datenbank-Seeding Skripte
Ôöé   Ôö£ÔöÇÔöÇ Dockerfile
Ôöé   Ôö£ÔöÇÔöÇ package.json
Ôöé   ÔööÔöÇÔöÇ tsconfig.json
Ôö£ÔöÇÔöÇ frontend/            # React/Vite Frontend
Ôöé   Ôö£ÔöÇÔöÇ src/
Ôöé   Ôöé   Ôö£ÔöÇÔöÇ components/  # React Komponenten
Ôöé   Ôöé   Ôö£ÔöÇÔöÇ pages/       # Seiten-Komponenten
Ôöé   Ôöé   Ôö£ÔöÇÔöÇ lib/         # API Client & Utilities
Ôöé   Ôöé   Ôö£ÔöÇÔöÇ store/       # Zustand Stores
Ôöé   Ôöé   Ôö£ÔöÇÔöÇ types/       # TypeScript Types
Ôöé   Ôöé   Ôö£ÔöÇÔöÇ App.tsx      # Main App Component
Ôöé   Ôöé   Ôö£ÔöÇÔöÇ main.tsx     # Entry Point
Ôöé   Ôöé   ÔööÔöÇÔöÇ index.css    # Global Styles
Ôöé   Ôö£ÔöÇÔöÇ public/          # Static Assets
Ôöé   Ôö£ÔöÇÔöÇ Dockerfile
Ôöé   Ôö£ÔöÇÔöÇ nginx.conf
Ôöé   Ôö£ÔöÇÔöÇ package.json
Ôöé   ÔööÔöÇÔöÇ vite.config.ts
Ôö£ÔöÇÔöÇ docker-compose.yml   # Docker Compose Konfiguration
Ôö£ÔöÇÔöÇ ROADMAP.md          # Feature Roadmap
Ôö£ÔöÇÔöÇ PRODUCTION_CHECKLIST.md  # Production Deployment Checklist
ÔööÔöÇÔöÇ README.md
```

## ­ƒÜÇ Quick Start

### Voraussetzungen

- **Docker & Docker Compose** (empfohlen) ODER
- **Node.js 20+** und **PostgreSQL 15+** f++r lokale Entwicklung

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
   # Migrationen ausf++hren
   docker-compose exec backend npx prisma migrate deploy

   # Optional: Sample-Daten einf++gen
   docker-compose exec backend npm run seed
   docker-compose exec backend npm run seed:airports:csv
   docker-compose exec backend npm run seed:achievements
   ```

4. **Anwendung +Âffnen**
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

# Migrationen ausf++hren
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

# .env anpassen falls n+Âtig
# VITE_API_URL=http://localhost:8000

# Development Server starten
npm run dev
```

## ­ƒöº Environment Variables

### Backend (.env)

```env
# Database
DATABASE_URL=postgresql://flights:password@localhost:5432/flights

# JWT - WICHTIG: In Production +ñndern!
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

## ­ƒôÜ API-Dokumentation

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

### Fl++ge (Authentifizierung erforderlich)

Alle Flight-Endpunkte erfordern `Authorization: Bearer <token>` Header.

#### Fl++ge abrufen
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

#### Flug l+Âschen
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

## ­ƒùä´©Å Datenbank-Schema

### Wichtige Tabellen

- **users** - Benutzer mit Authentifizierung
- **flights** - Flugdaten mit Geo-Informationen
- **airports** - Flughafen-Datenbank (IATA/ICAO)
- **achievements** - Achievement-Definitionen
- **user_achievements** - Freigeschaltete Achievements
- **user_settings** - Benutzer-Einstellungen (JSON)
- **analytics_events** - Analytics-Tracking

Siehe [backend/prisma/schema.prisma](backend/prisma/schema.prisma) f++r Details.

## ­ƒº¬ Testing

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

## ­ƒôª Production Deployment

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
   - Datenbank-Backups (t+ñglich)
   - Backup-Rotation
   - Offsite-Storage

­ƒôï Siehe [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) f++r vollst+ñndige Checkliste!

## ­ƒù¦´©Å Feature Roadmap

Siehe [ROADMAP.md](ROADMAP.md) f++r geplante Features und Entwicklungsphasen.

**Status**: Die meisten Kern-Features sind implementiert! ­ƒÄë

Highlights:
- Ô£à Kern-Visualisierungen (Distanz, Diagramme, Kalender)
- Ô£à Gamification (Achievements, Collections, Meilen)
- Ô£à Praktische Tools (Kosten, Tags, Einstellungen)
- Ô£à Umwelt & Analysen (CO2, Routen, Heatmaps)
- Ô£à Import & Export (Scanner, PDF, KML)

## ­ƒñØ Contributing

1. Fork das Repository
2. Feature Branch erstellen (`git checkout -b feature/AmazingFeature`)
3. +änderungen committen (`git commit -m 'Add some AmazingFeature'`)
4. Branch pushen (`git push origin feature/AmazingFeature`)
5. Pull Request +Âffnen

### Development Guidelines

- TypeScript f++r Type-Safety verwenden
- Zod-Schemas f++r Validierung
- Tests f++r neue Features schreiben
- Code-Style mit ESLint/Prettier einhalten
- Sinnvolle Commit-Messages

## ­ƒôä License

MIT License - siehe LICENSE-Datei f++r Details.

## ­ƒÖÅ Acknowledgments

- OpenStreetMap f++r Kartendaten
- Leaflet f++r die Karten-Bibliothek
- OurAirports f++r Flughafen-Daten
- React & TypeScript Community

## ­ƒôº Support & Kontakt

- **Issues**: GitHub Issues f++r Bug Reports und Feature Requests
- **Discussions**: GitHub Discussions f++r Fragen und Ideen

---

**Built with ÔØñ´©Å using modern web technologies**

*Viel Spa+ƒ beim Tracken Ihrer Fl++ge!* Ô£ê´©Å

---

### ­ƒôè Project Stats

- **Features**: 25+ implementiert
- **Lines of Code**: ~15,000+
- **Test Coverage**: 80%+
- **API Endpoints**: 30+
- **Database Tables**: 7
- **Supported Airports**: 7,000+

---

*Letzte Aktualisierung: 2025-11-22*
