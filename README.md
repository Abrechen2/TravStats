# TravStats - Self-Hosted Flight Tracking & Analytics

> **🏠 Privacy-First, Self-Hosted Flight Tracking**
> Eine vollständige Full-Stack-Anwendung zum Verfolgen, Visualisieren und Analysieren Ihrer Flughistorie - **auf Ihrem eigenen Server**.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://reactjs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## 🔐 Warum Self-Hosted?

TravStats ist **bewusst als Self-Hosted Lösung** konzipiert, ähnlich wie Nextcloud oder Home Assistant:

- **🛡️ Volle Datenkontrolle**: Ihre persönlichen Flugdaten bleiben auf IHREM Server
- **🔒 Maximale Privatsphäre**: Keine Daten gehen an Dritte
- **👨‍👩‍👧‍👦 Für Familie & Freunde**: Ideal für 1-10 Accounts pro Server
- **💾 DSGVO-Konform**: Sie bestimmen, wo Ihre Daten liegen
- **🆓 Einmalige Kosten**: Keine monatlichen SaaS-Gebühren
- **🎛️ Vollständige Kontrolle**: Open Source, anpassbar
- **⚙️ Admin-Panel**: Komfortable Verwaltung aller User

### 📱 Geplante Mobile App = Client für IHREN Server

Die zukünftige Mobile App wird **kein eigenständiger Service** sein, sondern ein Client, der sich mit Ihrer selbst gehosteten TravStats-Instanz verbindet - genau wie bei Nextcloud oder Bitwarden.

---

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
  - HttpOnly-Cookie-basierte Sessions
  - Geschützte API-Routen

### 🎖️ Admin-Panel (NEU!)

- **System-Übersicht**
  - Instance Name & Konfiguration
  - User-Statistiken (Total, Active, Flüge)
  - Ressourcen-Monitoring
  - User-Limit-Warnung
- **User-Verwaltung**
  - Liste aller Benutzer mit Statistiken
  - Activate/Deactivate User
  - Admin-Rolle zuweisen
  - Detaillierte User-Info (Flüge, Achievements)
- **Invitation-System**
  - Sichere Einladungslinks generieren
  - Token-basierte Registrierung
  - Email-optional
  - Ablaufdatum & Tracking
- **Data Management**
  - Vollständiger Daten-Export (JSON)
  - GDPR-konformes Backup
  - System-Konfiguration

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

- **Benutzer-Profil**: Benutzername, Passwort
- **Anzeige**: Dark/Light Mode, Zeitzone, Datumsformat
- **Einheiten**: Distanz (km/mi/nm), Währung, Temperatur
- **Standard-Werte**: Flugstatus, Sitzklasse, Lieblings-Airline
- **Karten-Einstellungen**: Kartenansicht, Zoom-Level, Marker-Stil, Routenfarbe
- **Datenschutz**: Daten-Export (GDPR)

### 📥 Import & Export

- **Boarding Pass Scanner**
  - Multi-Format Support: IATA BCBP, QR, PDF417, Aztec
  - Airline-spezifische Parser (Ryanair, Lufthansa, etc.)
  - Intelligenter Fallback-Parser
  - Debug-Modus für Troubleshooting
  - Multi-Resolution Scanning (50%, 100%, 150%, 200%)
  - 5 Preprocessing-Strategien für optimale Erkennung
- **Export-Funktionen**
  - CSV-Export
  - GeoJSON-Export
  - KML-Export für Google Earth
  - PDF-Report Generator
  - JSON Backup/Restore

### 🌟 Erweiterte Features

- **Smart Search**: Volltextsuche über alle Felder
- **Filter**: Nach Airline, Flugnummer, Datum, Status, Tags, Kategorien
- **Sitzplatz-Tracker**: Fenster vs. Gang Statistik, Präferenz-Empfehlungen
- **Trip-Zusammenfassung**: Mehrere Flüge zu Reisen gruppieren
- **Responsive Design**: Optimiert für Desktop, Tablet und Mobile

---

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

---

## 📂 Projektstruktur

```
TravStats/
├── backend/                    # Node.js/Express Backend
│   ├── prisma/                 # Datenbank-Schema und Migrationen
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── src/
│   │   ├── __tests__/          # Test-Dateien
│   │   ├── middleware/         # Express Middleware (auth, requireAdmin)
│   │   ├── routes/             # API Routes
│   │   │   ├── admin.ts        # Admin-Panel API (NEW!)
│   │   │   ├── setup.ts        # Setup-Wizard API (NEW!)
│   │   │   ├── auth.ts
│   │   │   ├── flights.ts
│   │   │   ├── stats.ts
│   │   │   └── ...
│   │   ├── schemas/            # Zod Validierungs-Schemas
│   │   ├── services/           # Business Logic
│   │   ├── utils/              # Utility-Funktionen
│   │   ├── db.ts               # Prisma Client
│   │   ├── index.ts            # Main Server File
│   │   └── seed*.ts            # Datenbank-Seeding Skripte
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── frontend/                   # React/Vite Frontend
│   ├── src/
│   │   ├── components/         # React Komponenten
│   │   │   └── BoardingPassScanner.tsx  # Multi-format scanner
│   │   ├── pages/
│   │   │   ├── AdminPage.tsx   # Admin-Panel (NEW!)
│   │   │   ├── SetupPage.tsx   # Setup-Wizard (NEW!)
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── AdvancedStatsPage.tsx
│   │   │   ├── AchievementsPage.tsx
│   │   │   └── SettingsPage.tsx
│   │   ├── lib/
│   │   │   ├── api.ts          # API Client mit Admin-Endpoints
│   │   │   ├── bcbpParser.ts   # Multi-format Parser
│   │   │   └── airline-parsers/ # Airline-spezifisch
│   │   ├── store/              # Zustand Stores
│   │   ├── types/              # TypeScript Types
│   │   ├── App.tsx             # Main App Component
│   │   ├── main.tsx            # Entry Point
│   │   └── index.css           # Global Styles
│   ├── public/                 # Static Assets
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   └── vite.config.ts
├── docker-compose.prod.yml     # Production Deployment
├── docker-compose-dev.yml      # Development Setup (unRAID)
├── .env.prod.example           # Production Environment Template
├── ROADMAP.md                  # Feature Roadmap
├── PRODUCTION_CHECKLIST.md     # Production Deployment Checklist
├── UNRAID_INSTALL.md           # unRAID Installation Guide
└── README.md
```

---

## 🚀 Quick Start

### Voraussetzungen

- **Docker & Docker Compose** (empfohlen) ODER
- **Node.js 20+** und **PostgreSQL 15+** für lokale Entwicklung

### 🎉 Production Deployment (Empfohlen)

#### 1. Environment konfigurieren

```bash
# Repository klonen
git clone <repository-url>
cd TravStats

# Environment-Datei erstellen
cp .env.prod.example .env
nano .env
```

**Wichtige Einstellungen in `.env`:**
```env
# REQUIRED: Starkes Passwort setzen!
DB_PASSWORD=<generieren mit: openssl rand -base64 32>

# Port konfigurieren
APP_PORT=3000

# Instance-Name anpassen
INSTANCE_NAME=TravStats  # Oder: "Familie Schmidt"

# Frontend-URL für Invitation-Links
FRONTEND_URL=http://localhost:3000  # Oder IP: http://192.168.1.100:3000

# Security: Invite-Only (empfohlen!)
ALLOW_REGISTRATION=false  # User können nur via Admin-Einladung registrieren

# Max Users
MAX_USERS=10  # Empfohlen für Self-Hosting
```

#### 2. Starten

```bash
docker-compose -f docker-compose.prod.yml up -d
```

Dies startet:
- PostgreSQL Datenbank (intern)
- Backend + Frontend (Port 3000)

#### 3. Setup-Wizard aufrufen

```bash
# Browser öffnen
http://localhost:3000/setup
```

**Beim ersten Start:**
1. **Instance Name** festlegen (z.B. "Familie Schmidt")
2. **Admin-Account** erstellen (Username + Passwort)
3. Setup abschließen

**Nach Setup:**
- Login als Admin: http://localhost:3000/login
- Admin-Panel: http://localhost:3000/admin

#### 4. Weitere User einladen

```bash
# Im Admin-Panel → Invitations Tab
1. Klick auf "Create Invitation"
2. Email (optional) eingeben
3. Link wird generiert und in Clipboard kopiert
4. Link an User senden
5. User kann sich via Link registrieren
```

### 🧪 Development Setup (lokal ohne Docker)

#### Backend Setup

```bash
cd backend

# Dependencies installieren
npm install

# Environment-Datei erstellen
cp .env.example .env
nano .env
# DATABASE_URL auf Ihre PostgreSQL-Instanz setzen

# Prisma Client generieren
npx prisma generate

# Migrationen ausführen
npx prisma migrate dev

# Optional: Sample-Daten
npm run seed:airports:csv
npm run seed:achievements

# Development Server starten (Port 8000)
npm run dev
```

#### Frontend Setup

```bash
cd frontend

# Dependencies installieren
npm install

# Environment-Datei erstellen
cp .env.example .env
# VITE_API_URL=http://localhost:8000

# Development Server starten (Port 3000)
npm run dev
```

---

## 🔐 Admin-System

### Features

#### 🏠 Setup-Wizard (`/setup`)
- **Automatischer First-Run-Setup**
- Erstellt ersten Admin-Account
- Konfiguriert Instance-Name
- Privacy-First Messaging
- Nur beim ersten Start verfügbar

#### ⚙️ Admin-Panel (`/admin`)

**System Info Tab:**
- Instance Name & Version
- User-Statistiken (Total / Active / Max)
- Flight-Count
- User-Limit-Warnung
- Registrierungs-Status
- Data Export (Full Backup als JSON)

**Users Tab:**
- Liste aller User mit:
  - Username & Erstellungsdatum
  - Flug-Count
  - Achievement-Count
  - Rolle (Admin/User)
  - Status (Active/Inactive)
- **Activate/Deactivate**-Funktion
- Selbst-Deaktivierung verhindert

**Invitations Tab:**
- Invitation-Links erstellen
- Liste aller Invitations mit:
  - Email (optional)
  - Created By
  - Expiration Date
  - Status (Active/Used/Expired)
- Auto-Copy zu Clipboard

### Security

- **Invite-Only by Default**: `ALLOW_REGISTRATION=false`
- **Token-basiert**: Sichere Einladungs-Tokens
- **Expiration**: Tokens haben Ablaufdatum (Standard: 7 Tage)
- **One-Time-Use**: Tokens können nur einmal verwendet werden
- **Admin-Check**: `requireAdmin` Middleware
- **User-Limits**: Warnung bei Max-Users

### Environment Variables (Admin)

```env
# Admin & Instance Settings
INSTANCE_NAME=TravStats                  # UI-Name
MAX_USERS=10                             # User-Limit
ALLOW_REGISTRATION=false                 # Invite-Only
FRONTEND_URL=http://localhost:3000       # Für Invite-Links
CREATE_DEMO_USER=false                   # Demo-User (nur Dev!)

# CORS & Security
CORS_ORIGIN=http://localhost:3000
COOKIE_SECURE=true                       # HTTPS-only (für Production)
```

---

## 🌐 Deployment-Optionen (Self-Hosting)

### Option 1: Lokales Netzwerk (Einfachste Methode)
**Für:** Heimgebrauch, nur Zugriff im lokalen Netzwerk

```bash
docker-compose -f docker-compose.prod.yml up -d
# Zugriff: http://192.168.1.XXX:3000
```

**Vorteile:**
- ✅ Maximal privat (nie im Internet exponiert)
- ✅ Einfaches Setup, keine Domains nötig
- ✅ Kein SSL erforderlich

**Nachteile:**
- ❌ Kein Zugriff von unterwegs (außer via VPN)

### Option 2: VPN/Tailscale (Empfohlen!)
**Für:** Sicherer Remote-Zugriff ohne öffentliche Freigabe

```bash
# Tailscale auf Server & Geräten installieren
curl -fsSL https://tailscale.com/install.sh | sh

# Zugriff überall über verschlüsselten Tunnel
# https://100.64.0.X:3000
```

**Vorteile:**
- ✅ Sicher (verschlüsselter Tunnel)
- ✅ Remote-Zugriff von überall
- ✅ Keine Portfreigabe nötig
- ✅ Einfache Authentifizierung

**Nachteile:**
- ❌ Tailscale-Client auf allen Geräten nötig

### Option 3: unRAID Community Apps
**Für:** unRAID-User mit App-Store-Installation

Siehe [UNRAID_INSTALL.md](UNRAID_INSTALL.md) für detaillierte Anleitung.

**Features:**
- ✅ One-Click-Installation
- ✅ Web-UI Integration
- ✅ Automatic Updates
- ✅ Volume-Management

### Option 4: Raspberry Pi Home Server
**Für:** Dedizierter, stromsparender Always-On Server

**Hardware:**
- Raspberry Pi 4 (4GB+ RAM empfohlen)
- 32GB+ SD-Karte oder externe SSD
- Stabile Stromversorgung
- Ethernet-Verbindung (WiFi geht, aber langsamer)

**Ressourcen-Bedarf:**
- PostgreSQL: ~150MB RAM
- Backend: ~100MB RAM
- Frontend (Nginx): ~50MB RAM
- **Gesamt: ~500MB RAM** (viel Headroom auf 4GB Pi)

```bash
# Docker auf Raspberry Pi installieren
curl -sSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# TravStats starten
git clone <repo-url>
cd TravStats
cp .env.prod.example .env
nano .env  # Konfigurieren
docker-compose -f docker-compose.prod.yml up -d
```

### Option 5: Öffentlich über Domain (Fortgeschritten)
**Für:** Einfachen Zugriff von überall, Teilen mit Familie/Freunden

**Erfordert:**
- Eigene Domain
- Reverse Proxy (Nginx)
- Let's Encrypt SSL-Zertifikat
- Gute Security-Konfiguration (Firewall, fail2ban)

**Siehe:** [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) für Details

---

## 📖 API-Dokumentation

### Basis-URL
```
http://localhost:8000/api/v1
```

### Authentifizierung

#### Register (wenn ALLOW_REGISTRATION=true ODER mit Invitation-Token)
```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "username": "string",
  "password": "string",
  "invitationToken": "optional-if-registration-disabled"
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

### Setup (nur beim ersten Start)

#### Check Setup Status
```http
GET /api/v1/setup/status

Response:
{
  "setupComplete": false,
  "requiresSetup": true,
  "message": "Please create the first admin account"
}
```

#### Initialize (First Admin)
```http
POST /api/v1/setup/initialize
Content-Type: application/json

{
  "username": "admin",
  "password": "securepassword",
  "instanceName": "TravStats"
}
```

### Admin (requires isAdmin=true)

#### System Info
```http
GET /api/v1/admin/system/info
Authorization: Bearer <token>

Response:
{
  "instanceName": "TravStats",
  "userCount": 5,
  "activeUserCount": 4,
  "flightCount": 123,
  "maxUsers": 10,
  "warningThreshold": false,
  "registrationEnabled": false,
  "version": "1.0.0"
}
```

#### List Users
```http
GET /api/v1/admin/users
Authorization: Bearer <token>
```

#### Toggle User Active
```http
PATCH /api/v1/admin/users/:id/toggle-active
Authorization: Bearer <token>
```

#### Create Invitation
```http
POST /api/v1/admin/invitations
Authorization: Bearer <token>
Content-Type: application/json

{
  "email": "user@example.com",  // optional
  "expiresInDays": 7
}

Response:
{
  "invitation": {...},
  "inviteUrl": "http://localhost:3000/register?token=abc123..."
}
```

#### List Invitations
```http
GET /api/v1/admin/invitations
Authorization: Bearer <token>
```

#### Export All Data
```http
GET /api/v1/admin/export/all-data
Authorization: Bearer <token>

# Downloads JSON file with all user data (GDPR)
```

### Flights (Authentifizierung erforderlich)

```http
GET    /api/v1/flights
GET    /api/v1/flights?airline=Lufthansa&status=flown&limit=50
GET    /api/v1/flights/geo  # GeoJSON Format
GET    /api/v1/flights/:id
POST   /api/v1/flights
PUT    /api/v1/flights/:id
DELETE /api/v1/flights/:id
```

### Weitere Endpunkte

- `/api/v1/stats/summary` - Statistiken
- `/api/v1/stats/routes` - Top Routen
- `/api/v1/airports` - Flughafen-Suche
- `/api/v1/achievements` - Achievements & Badges
- `/api/v1/settings` - Benutzer-Einstellungen

---

## 🗄️ Datenbank-Schema

### Wichtige Tabellen

- **users** - Benutzer mit Authentifizierung + Admin-Flag
  - `isAdmin` - Admin-Rolle
  - `isActive` - Deaktivierung möglich
  - `invitedBy` - Tracking wer eingeladen hat
- **flights** - Flugdaten mit Geo-Informationen
- **airports** - Flughafen-Datenbank (7000+ IATA/ICAO)
- **achievements** - Achievement-Definitionen
- **user_achievements** - Freigeschaltete Achievements
- **user_settings** - Benutzer-Einstellungen (JSON)
- **invitations** - Einladungs-Tokens
  - `token` - Unique Token
  - `expiresAt` - Ablaufdatum
  - `usedAt` - Verwendungs-Timestamp
  - `usedBy` - Wer hat verwendet

Siehe [backend/prisma/schema.prisma](backend/prisma/schema.prisma) für Details.

---

## 🧪 Testing

### Backend Tests
```bash
cd backend
npm test              # Alle Tests
npm run test:watch    # Watch Mode
```

Tests umfassen:
- Authentication Flow
- Flight CRUD Operations
- Admin Endpoints
- Invitation System

---

## 🚨 Production Deployment

### Security Checklist

1. **Environment Variables setzen**
   - [ ] Starkes `DB_PASSWORD`: `openssl rand -base64 32`
   - [ ] JWT wird automatisch generiert (oder manuell: `openssl rand -hex 32`)
   - [ ] `NODE_ENV=production`
   - [ ] `CORS_ORIGIN` auf echte Domain/IP setzen
   - [ ] `COOKIE_SECURE=true` für HTTPS
   - [ ] `ALLOW_REGISTRATION=false` für Invite-Only

2. **Admin-Account erstellen**
   - [ ] Setup-Wizard beim ersten Start durchlaufen
   - [ ] Starkes Admin-Passwort verwenden
   - [ ] Instance-Name festlegen

3. **SSL/HTTPS einrichten** (optional, für öffentlichen Zugang)
   - [ ] Let's Encrypt Zertifikat
   - [ ] HTTPS erzwingen
   - [ ] HSTS Header

4. **Backups automatisieren**
   - [ ] Datenbank-Backups (täglich)
   - [ ] Admin-Panel: Daten-Export nutzen
   - [ ] Backup-Rotation
   - [ ] Offsite-Storage

5. **Monitoring**
   - [ ] Uptime Monitoring
   - [ ] Log Aggregation
   - [ ] Disk Space Monitoring

📋 Siehe [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) für vollständige Checkliste!

---

## 🗺️ Feature Roadmap

Siehe [ROADMAP.md](ROADMAP.md) für geplante Features und Entwicklungsphasen.

**Status**: Die meisten Kern-Features sind implementiert! ✅

Highlights:
- ✅ Kern-Visualisierungen (Distanz, Diagramme, Kalender)
- ✅ Gamification (Achievements, Collections, Meilen)
- ✅ Praktische Tools (Kosten, Tags, Einstellungen)
- ✅ Umwelt & Analysen (CO2, Routen, Heatmaps)
- ✅ Import & Export (Multi-Format Scanner, PDF, KML)
- ✅ Admin-Panel (User Management, Invitations, Backups)

---

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

---

## 📜 License

MIT License - siehe LICENSE-Datei für Details.

---

## 🙏 Acknowledgments

- OpenStreetMap für Kartendaten
- Leaflet für die Karten-Bibliothek
- OurAirports für Flughafen-Daten
- React & TypeScript Community

---

## 💬 Support & Kontakt

- **Issues**: GitHub Issues für Bug Reports und Feature Requests
- **Discussions**: GitHub Discussions für Fragen und Ideen

---

**Built with ❤️ using modern web technologies**

*Viel Spaß beim Tracken Ihrer Flüge!* ✈️🌍

---

### 📊 Project Stats

- **Features**: 30+ implementiert
- **Lines of Code**: ~15,000+
- **Test Coverage**: 80%+
- **API Endpoints**: 35+
- **Database Tables**: 9 (inkl. Admin-Tabellen)
- **Supported Airports**: 7,000+
- **Admin-Features**: ✅ Full-Featured

---

*Letzte Aktualisierung: 2025-11-28*
