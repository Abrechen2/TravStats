# TravStats - Quick Start Guide

> **Get up and running in 5 minutes!**

This guide shows you the fastest way to start TravStats, with Unraid as the primary production path.

---

## ÐY"< Prerequisites

**Option A: Unraid (Production, recommended)**
- Unraid 6.9+ with Community Apps
- Separate PostGIS database container (`postgis/postgis`)
- Optional: Ollama container if you want the LLM parser

**Option B: Docker Compose (Local testing/dev)**
- Docker & Docker Compose installed

**Option C: Manual Dev**
- Node.js 20+
- Postgres 15+ with PostGIS extension
- Git

---

## ÐYZ% Production Setup (Unraid)

### Step 1: PostGIS database
- In Community Apps search for `postgis` and install `postgis/postgis`.
- Suggested: Container name `travstats-db`, Port `5432`, DB/User `flights`, your own strong password.
- Persist data to `/mnt/user/appdata/travstats-db`.

### Step 2: (Optional) Ollama
- Only if you need AI parsing: install an Ollama container in Unraid.
- Point `OLLAMA_URL` to that container and set `USE_LLM_PARSER=true`.
- If Ollama is not available, keep `USE_LLM_PARSER=false` and the app uses the Regex/standard parser.

### Step 3: Install TravStats from Community Apps
- Select template `TravStats`.
- Set `DATABASE_URL` to your PostGIS instance (`postgresql://flights:<pw>@travstats-db:5432/flights`).
- Keep `SEED_AIRPORTS=true` for the first start.
- Choose your WebUI port (default 3000) and AppData path.

### Step 4: Run the setup wizard (LAN)
```
http://<unraid-ip>:3000/setup
```
- Pick an instance name and create the first admin user.

### Step 5: Keep it internal or publish intentionally
- Default: stay inside your LAN (`http://<unraid-ip>:3000`).
- Optional: publish via Nginx Proxy Manager + Cloudflare (DNS/Proxy/Tunnel) with proper TLS; leave the database closed to the internet.

### Step 6: Updates & maintenance
- Unraid Docker tab → TravStats → Check for Updates / Force Update.
- Update PostGIS and optional Ollama separately; take regular DB backups.

---

## ÐYơ¦ Alternative: Docker Compose (Local Testing)

### Step 1: Get the code
```bash
git clone <repository-url>
cd TravStats
```

### Step 2: Configure environment
```bash
cp .env.prod.example .env
# Set DB_PASSWORD, adjust USE_LLM_PARSER/OLLAMA_URL if needed
```

### Step 3: Start stack
```bash
docker-compose -f docker-compose.prod.yml up -d
```
- Starts PostGIS, the app, and optional Ollama locally.
- Setup wizard: `http://localhost:3000/setup`

---

## ÐYơ¦ Development Setup (Local without Docker)

### Step 1: Backend
```bash
cd backend
npm install
cp .env.example .env
# DATABASE_URL must point to a PostGIS instance
npx prisma generate
npx prisma migrate dev
# Optional seeds
npm run seed:airports:csv
npm run seed:achievements
npm run dev   # Port 8000
```

### Step 2: Frontend
```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_URL=http://localhost:8000
npm run dev            # Port 3000
```

### Step 3: Setup
1. Open http://localhost:3000/setup
2. Create first admin
3. Start tracking flights

---

## ÐYO? Access TravStats

### Same device
```
http://localhost:3000
```

### Other devices in LAN
```
http://192.168.1.XXX:3000
```

### Optional external access
- Use Nginx Proxy Manager + Cloudflare (DNS/Proxy/Tunnel) with TLS.
- Do not expose the database; only forward the app port via the proxy.

---

## ÐY'Ï Admin Features

**Admin Panel:** `http://<host>:3000/admin`

- System info (users, flights, config)
- User management (activate/deactivate)
- Invitations (invite-only by default)
- Data export (JSON)

---

## ÐY>ÿ‹÷? Useful Commands

### Unraid (GUI)
- Logs: Docker tab → TravStats → Logs
- Restart: Docker tab → TravStats → Restart
- Update: Docker tab → TravStats → Check for Updates / Force Update

### Docker Compose (local testing)
```bash
docker-compose -f docker-compose.prod.yml logs -f
docker-compose -f docker-compose.prod.yml restart
docker-compose -f docker-compose.prod.yml pull && docker-compose -f docker-compose.prod.yml up -d
docker-compose -f docker-compose.prod.yml exec db psql -U flights -d flights
docker-compose -f docker-compose.prod.yml exec app sh
```

### Development
```bash
# Backend
cd backend
npm run dev
npm test
npm run build
npx prisma studio

# Frontend
cd frontend
npm run dev
npm run build
npm run preview
```

---

## ÐY"S Default Settings

| Setting | Production | Development |
|---------|-----------|-------------|
| **Port** | 3000 | 3000 (Frontend), 8000 (Backend) |
| **Registration** | Invite-only (`false`) | Open (`true`) |
| **Max Users** | 10 | 50 |
| **Demo User** | No | Yes (demo/demo123) |
| **HTTPS Cookies** | Yes (`true`) | No (`false`) |
| **Instance Name** | "TravStats" | "TravStats Dev" |

---

## ÐY"? Troubleshooting

- **Port already in use:** pick another WebUI port (e.g., 3001) in Unraid or set `APP_PORT` in Compose.
- **Database connection failed:** ensure PostGIS container is running and `DATABASE_URL` uses the right host/user/password.
- **Setup page not showing:** setup runs only once; use `/login` if a user already exists.
- **Invitation link invalid:** `FRONTEND_URL` must match the URL users hit (LAN IP or your proxy hostname).

---

## ÐY"' Security Recommendations

- Keep the app LAN-only by default; expose externally only via Nginx Proxy Manager + Cloudflare with TLS or via VPN (WireGuard/Tailscale).
- Do not expose the PostGIS port to the internet.
- Use strong passwords and keep `ALLOW_REGISTRATION=false` for production.
- Follow [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) for hardening.

---

## ÐY"s Further Reading

- **Full Documentation:** [README.md](README.md)
- **Production Checklist:** [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md)
- **Unraid Install:** [UNRAID_INSTALL.md](UNRAID_INSTALL.md)
- **Feature Roadmap:** [ROADMAP.md](ROADMAP.md)

---

## ÐY'­ Tips

- Backups: dump the PostGIS DB regularly and/or use Admin export.
- Updates: refresh TravStats, PostGIS, and optional Ollama images periodically.
- Performance: ideal for 1-10 users per instance; database grows ~1MB per 100 flights.
- Mobile: responsive web UI works well on phones/tablets.

---

**Enjoy tracking your flights!**
