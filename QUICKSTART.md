# TravStats - Quick Start Guide

> **🚀 Get up and running in 5 minutes!**

This guide shows you the fastest way to start using TravStats on your own server.

---

## 📋 Prerequisites

**Option A: Docker (Recommended - Easiest)**
- Docker & Docker Compose installed
- That's it! Everything else is included.

**Option B: Manual Setup (Development)**
- Node.js 20+
- PostgreSQL 15+
- Git

---

## 🎉 Production Setup (Docker - Recommended)

### Step 1: Get the Code

```bash
git clone <repository-url>
cd TravStats
```

### Step 2: Configure Environment

```bash
# Copy environment template
cp .env.prod.example .env

# Edit configuration
nano .env  # or use your favorite editor
```

**Minimal configuration (required):**
```env
# REQUIRED: Change this to a strong password!
DB_PASSWORD=<generate with: openssl rand -base64 32>

# Port where TravStats will be accessible
APP_PORT=3000

# Instance name (shown in UI)
INSTANCE_NAME=TravStats  # Or: "Smith Family Tracker"

# Frontend URL for invitation links
# Use your server's IP for LAN access
FRONTEND_URL=http://localhost:3000  # Or: http://192.168.1.100:3000
```

**Security settings (recommended):**
```env
# Invite-only registration (recommended for self-hosting)
ALLOW_REGISTRATION=false  # Users can only register via admin-created invitations

# Max users (recommended for small instances)
MAX_USERS=10
```

### Step 3: Start TravStats

```bash
docker-compose -f docker-compose.prod.yml up -d
```

This will:
- Pull the Docker images
- Start PostgreSQL database
- Start the application (frontend + backend)
- Automatically run database migrations

### Step 4: Complete Setup Wizard

Open your browser and navigate to:
```
http://localhost:3000/setup
```

**Setup Wizard will guide you through:**
1. **Instance Name**: Choose a name (e.g., "Smith Family Tracker")
2. **Admin Account**: Create the first admin user
3. **Password**: Set a strong admin password

After completing setup, you'll be redirected to the login page.

### Step 5: Login as Admin

```
http://localhost:3000/login
```

Use the username and password you just created.

### Step 6: Invite Other Users (Optional)

1. Navigate to **Admin Panel**: http://localhost:3000/admin
2. Go to **Invitations** tab
3. Click **"Create Invitation"**
4. Optionally enter an email
5. Link is auto-copied to clipboard
6. Send the link to your family/friends
7. They can register using the invitation token

---

## 🧪 Development Setup (Local without Docker)

### Step 1: Setup Backend

```bash
cd backend

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Edit .env and set your DATABASE_URL
nano .env
# Example: DATABASE_URL=postgresql://user:password@localhost:5432/flights

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Optional: Seed airports and achievements
npm run seed:airports:csv
npm run seed:achievements

# Start backend (Port 8000)
npm run dev
```

### Step 2: Setup Frontend

```bash
cd frontend

# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Content: VITE_API_URL=http://localhost:8000

# Start frontend (Port 3000)
npm run dev
```

### Step 3: Complete Setup

1. Open http://localhost:3000/setup
2. Create first admin account
3. Login and start tracking flights!

---

## 🌐 Access TravStats

### On Same Computer
```
http://localhost:3000
```

### From Other Devices on Local Network
```
http://192.168.1.XXX:3000
```
*(Replace XXX with your server's IP address)*

**To find your IP:**
```bash
# Windows
ipconfig

# Linux/Mac
ip addr show
# or
ifconfig
```

---

## 👤 Admin Features

### Access Admin Panel
```
http://localhost:3000/admin
```

**Admin Panel Features:**
- **System Info**: View user count, flight count, instance configuration
- **User Management**: Activate/deactivate users, view statistics
- **Invitations**: Create invitation links for new users
- **Data Export**: Download full backup (JSON format, GDPR compliant)

### Invite-Only Registration

When `ALLOW_REGISTRATION=false` (default in production):
1. Users cannot self-register
2. Only admin can create invitation links
3. Each link has a unique token
4. Links expire after 7 days (default)
5. Links can only be used once

**To invite a user:**
1. Go to Admin Panel → Invitations
2. Click "Create Invitation"
3. Enter email (optional)
4. Link is generated: `http://localhost:3000/register?token=abc123...`
5. Send link to user
6. User registers via link

---

## 🛠️ Useful Commands

### Docker Commands

```bash
# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Stop TravStats
docker-compose -f docker-compose.prod.yml down

# Restart TravStats
docker-compose -f docker-compose.prod.yml restart

# Update to latest version
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d

# Access database shell
docker-compose -f docker-compose.prod.yml exec db psql -U flights -d flights

# Run backend shell (for manual commands)
docker-compose -f docker-compose.prod.yml exec app sh
```

### Development Commands

```bash
# Backend
cd backend
npm run dev              # Start dev server
npm test                 # Run tests
npm run build            # Build for production
npx prisma studio        # Open database GUI

# Frontend
cd frontend
npm run dev              # Start dev server
npm run build            # Build for production
npm run preview          # Preview production build
```

---

## 📊 Default Settings

| Setting | Production | Development |
|---------|-----------|-------------|
| **Port** | 3000 | 3000 (Frontend), 8000 (Backend) |
| **Registration** | Invite-only (`false`) | Open (`true`) |
| **Max Users** | 10 | 50 |
| **Demo User** | No | Yes (demo/demo123) |
| **HTTPS Cookies** | Yes (`true`) | No (`false`) |
| **Instance Name** | "TravStats" | "TravStats Dev" |

---

## 🔍 Troubleshooting

### Port already in use
```bash
# Check what's using port 3000
# Windows
netstat -ano | findstr :3000

# Linux/Mac
lsof -i :3000

# Change port in .env
APP_PORT=3001
```

### Database connection failed
```bash
# Check if database is running
docker-compose -f docker-compose.prod.yml ps

# Check logs
docker-compose -f docker-compose.prod.yml logs db

# Restart database
docker-compose -f docker-compose.prod.yml restart db
```

### Setup page not showing
```bash
# Check if setup is already complete
# If users exist, setup is complete
# You must use /login instead

# To reset (WARNING: deletes all data!)
docker-compose -f docker-compose.prod.yml down -v
docker-compose -f docker-compose.prod.yml up -d
```

### Cannot create admin account
```bash
# Make sure no users exist yet
# Setup is only available on first run
# If you need to reset, delete the database volume

# View existing users (from database)
docker-compose -f docker-compose.prod.yml exec db psql -U flights -d flights -c "SELECT * FROM users;"
```

### Invitation link not working
```bash
# Check FRONTEND_URL in .env
# It must match the actual URL users access
# Example: http://192.168.1.100:3000

# Verify in Admin Panel that link is correct
# Links expire after 7 days
# Links can only be used once
```

---

## 📱 Next Steps

### Add Your First Flight

1. Navigate to Dashboard: http://localhost:3000
2. Click **"Add Flight"** button
3. Fill in flight details OR
4. Use **Boarding Pass Scanner** to scan a QR code

### Explore Features

- **Map View**: See all your flights on an interactive map
- **Stats**: View comprehensive statistics and analytics
- **Achievements**: Unlock badges and track progress
- **Settings**: Customize your experience (dark mode, units, etc.)

### Invite Family & Friends

1. Go to Admin Panel
2. Create invitation links
3. Share with family members
4. They register and start tracking their flights!

---

## 🔒 Security Recommendations

### For Local Network Only (Safest)
- Keep `ALLOW_REGISTRATION=false`
- Use strong passwords
- No additional security needed
- Access via `http://192.168.1.XXX:3000`

### For Remote Access (via VPN)
- Use Tailscale or WireGuard
- Secure encrypted tunnel
- No port forwarding needed
- Access via VPN IP

### For Public Internet (Advanced)
- See [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md)
- Requires domain, SSL, reverse proxy
- Strong firewall configuration
- Regular security updates

---

## 📚 Further Reading

- **Full Documentation**: [README.md](README.md)
- **Production Deployment**: [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md)
- **unRAID Installation**: [UNRAID_INSTALL.md](UNRAID_INSTALL.md)
- **Feature Roadmap**: [ROADMAP.md](ROADMAP.md)

---

## 💡 Tips

- **Backups**: Use Admin Panel → Data Export regularly
- **Updates**: Pull latest Docker image periodically
- **Performance**: Recommended for 1-10 users per instance
- **Storage**: PostgreSQL database grows ~1MB per 100 flights
- **Mobile**: Use responsive web UI on phone/tablet

---

**Enjoy tracking your flights!** ✈️🌍

*If you encounter any issues, check the [Troubleshooting](#-troubleshooting) section or open a GitHub issue.*
