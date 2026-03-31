# ✈️ TravStats

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Version](https://img.shields.io/badge/version-0.9.0--beta-orange.svg)](https://github.com/Abrechen2/TravStats/releases)
[![CI](https://github.com/Abrechen2/TravStats/actions/workflows/ci.yml/badge.svg)](https://github.com/Abrechen2/TravStats/actions/workflows/ci.yml)

> ### 🚧 Public Beta — v0.9.0-beta
>
> TravStats is functional and actively used, but not yet feature-complete. The following core features work well:
> flight tracking, interactive 2D/3D maps, statistics, 58 achievements, boarding pass scanning, email import, and data export.
>
> **Known gaps (still in development):**
> - Automated database backups (UI exists, backend logic pending)
> - CSV bulk import
> - CO₂ footprint tracker
> - PDF report export
> - PWA / offline support
>
> **Recommendation:** Take regular manual backups via *Admin → Export* until automated backups are live.
> Bugs and feedback welcome via [GitHub Issues](https://github.com/Abrechen2/TravStats/issues).

Self-hosted flight tracking and statistics app for small groups (1-10 accounts). Track your flights, visualize routes on interactive maps, and collect achievements.

## 🚀 Features

- **Flight Tracking**: Record flights with categories, tags, travel companions (up to 50), and costs
- **Interactive Maps**: 6 visualization modes — Routes, Heatmap, Hexagon (3D), 3D Columns, Trips (animated), Globe
- **Statistics**: Year-over-year comparison, seat distribution (window/middle/aisle/zone/class), distance, flight time, costs, top routes
- **Duplicate Detection**: Smart detection of same flight/day combinations; override with "Add Anyway" button
- **Flight Certificates**: Downloadable PNG stats card with total flights, distance, time, top airline, years active
- **Seat Statistics**: Track window/middle/aisle seats, zones (front/bulkhead/exit/standard), cabin classes
- **Achievements**: 58 Battlefield-style achievements in 5 categories
- **Boarding Pass Scanner**: QR code and barcode scanning with OCR
- **Email Import**: Automatic import of flight confirmations (optional with AI via Ollama)
- **Email Notifications**: Configurable flight reminders (24h and 2h before departure via SMTP)
- **Export**: CSV, GeoJSON, KML (Google Earth)
- **Admin Panel**: User management, invitations, SMTP configuration, system info, data export

## 📦 Installation with Docker

### Prerequisites

- Docker & Docker Compose
- PostgreSQL 15 with PostGIS extension (separate container)

### Quick Start

1. **Start PostgreSQL/PostGIS container:**
```bash
docker run -d \
  --name travstats-db \
  -e POSTGRES_DB=flights \
  -e POSTGRES_USER=flights \
  -e POSTGRES_PASSWORD=your_secure_password \
  -v travstats-db-data:/var/lib/postgresql/data \
  postgis/postgis:15-3.4
```

2. **Start TravStats container:**
```bash
docker run -d \
  --name travstats-app \
  -p 3000:80 \
  -e DATABASE_URL=postgresql://flights:your_secure_password@travstats-db:5432/flights \
  -e SEED_AIRPORTS=true \
  -v travstats-app-data:/app/data \
  --link travstats-db:db \
  abrechen2/travstats:latest
```

3. **Open the app:**
   - Navigate to `http://localhost:3000/setup`
   - Create your admin account
   - Start tracking!

### Docker Compose (recommended)

```bash
# Create .env file
cp .env.prod.example .env

# Adjust passwords and options in .env
nano .env

# Start containers
docker compose -f docker-compose.prod.yml up -d
```

## 🐳 Docker Hub

The image is available on Docker Hub:
```
abrechen2/travstats:latest
```

## ⚙️ Configuration

### Important Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | **Required** |
| `SEED_AIRPORTS` | Fill airport database on startup | `true` |
| `ALLOW_REGISTRATION` | Allow public registration | `false` |
| `MAX_USERS` | Maximum number of users | `10` |
| `INSTANCE_NAME` | Instance name | `TravStats` |
| `OLLAMA_URL` | Ollama service URL | `http://localhost:11434` |
| `OLLAMA_MODEL` | Base model for email parsing | `qwen2.5:7b` |
| `OLLAMA_VISION_MODEL` | Base model for vision parsing | `llama3.2-vision` |
| `TRAINING_MODEL_OUTPUT_DIR` | Storage location for trained models | `./data/training/models` |
| `TRAINING_EMAIL_MODEL_NAME` | Name for trained email model | `travstats-email-custom` |
| `TRAINING_VISION_MODEL_NAME` | Name for trained vision model | `travstats-vision-custom` |

### Optional API Keys

- **AirLabs API Key**: Automatic flight data search (Free Tier: 1000 req/month)
  - `AIRLABS_API_KEY=your_key`
- **OpenSky Network**: Fallback for flight data
  - `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET`

### AI Parser (Ollama)

For AI-powered email import:

1. Install Ollama container:
```bash
docker run -d --name ollama -v ollama-data:/root/.ollama ollama/ollama:latest
```

2. Set environment variables:
```bash
OLLAMA_URL=http://ollama:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_VISION_MODEL=llama3.2-vision
```

## 📖 Usage

1. **Record first flight**: Dashboard → "New Flight"
2. **Add travel companions**: Enter names as tags (up to 50 per flight, 100 chars each)
3. **Record seat info**: Specify position (window/middle/aisle), zone, and cabin class
4. **Scan boarding pass**: Use upload function (QR/barcode/OCR)
5. **View statistics**: Stats page with year comparison and seat distribution
6. **Download certificate**: Stats page → Download PNG card with flight achievements
7. **Enable reminders**: Settings → Notifications → Enter email + enable 24h/2h alerts
8. **Unlock achievements**: Automatically when reaching milestones
9. **Export data**: Admin Panel → Export (CSV/GeoJSON/KML)

## 🔔 Email Notifications (Optional)

To enable flight reminders:

1. **Admin → Settings → Email (SMTP)**: Configure your mail server
2. **Settings → Notifications**: Enter your email and enable 24h/2h reminders
3. **Done**: Receive automatic reminders before flights depart

Reminders are checked every 15 minutes and sent based on configured thresholds (24 hours and 2 hours before departure).

## 🛠️ API Endpoints (Selection)

### Flight Management
- `POST /api/v1/flights` — Create flight
  - Returns 409 if duplicate (same flightNumber + day) with `existingFlight` details
  - Use `?force=true` to bypass duplicate detection
- `GET /api/v1/flights` — List user's flights
- `PUT /api/v1/flights/:id` — Update flight (companions, tags, cost, seatPosition, etc.)

### Statistics
- `GET /api/v1/stats/summary?year=YYYY&compareYear=YYYY` — Summary with optional year comparison
- `GET /api/v1/stats/seats` — Seat distribution by position, zone, and cabin class
- `GET /api/v1/stats/routes` — Top routes by frequency
- `GET /api/v1/stats/airlines` — Flight count by airline

### Admin
- `GET /api/v1/admin/smtp` — Get SMTP config (password masked)
- `PUT /api/v1/admin/smtp` — Update SMTP settings
- `POST /api/v1/admin/smtp/test` — Test connection

**Rate Limiting:** Stats endpoints: 30 req/min · Admin export: 5 req/hr

For complete API docs, see backend source at `backend/src/routes/`

## 🔒 Security

- **Invite-only**: No public registration by default
- **JWT Authentication**: HttpOnly cookie, automatically generated secure secrets
- **Rate Limiting**: Protection against abuse on all sensitive endpoints
- **Local Data**: All data stays on your server

## 🛠️ Development

```bash
# Install all dependencies
npm run install:all

# Start backend (port 8000) + frontend (port 3000) simultaneously
npm run dev

# Type checks
npm run typecheck

# Tests (frontend only — backend requires PostgreSQL)
npm run test:frontend

# Linting
npm run lint
```

See [CLAUDE.md](CLAUDE.md) for the full developer reference and [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

## 📝 License

Copyright (C) 2026 Dennis Wittke

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

**TL;DR:** You can use, modify, and distribute this software, but if you run it as a web service (even modified), you must make the complete source code (including your modifications) available under AGPL-3.0.

See [LICENSE](LICENSE) for full details.

## 🔗 Links

- **Docker Hub**: [abrechen2/travstats](https://hub.docker.com/r/abrechen2/travstats)
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)
- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md)
- **Issues**: [GitHub Issues](https://github.com/Abrechen2/TravStats/issues)

---

**Made with ❤️ and a bit of AI for flight enthusiasts**
