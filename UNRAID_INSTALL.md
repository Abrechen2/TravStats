# TravStats - Unraid Installation Guide

## 📋 Prerequisites

- Unraid 6.9+ recommended
- Community Applications plugin installed
- At least 2GB free RAM
- 500MB storage space for application
- 1GB+ storage for database (grows with your flight data)

---

## 🚀 Installation Steps

### Step 1: Install PostgreSQL Database

1. **Open Unraid Dashboard** → Apps Tab
2. **Search** for `postgis`
3. **Select** `postgis/postgis` (official image)
4. **Click** "Install"

**Configuration:**

| Setting | Value |
|---------|-------|
| **Container Name** | `travstats-db` |
| **Repository** | `postgis/postgis:15-3.4` |
| **Network Type** | `bridge` |
| **Port** | `5432:5432` |
| **POSTGRES_DB** | `flights` |
| **POSTGRES_USER** | `flights` |
| **POSTGRES_PASSWORD** | Choose a **STRONG** password! |
| **Volume (Data)** | `/mnt/user/appdata/travstats-db` → `/var/lib/postgresql/data` |

**Important:**
- ⚠️ **Write down your database password** - you'll need it in Step 2!
- ✅ Wait for container to start and show "Healthy" status

---

### Step 2: Install TravStats Application

#### Option A: Via Community Applications (Recommended when available)

1. **Search** for `TravStats` in Community Apps
2. **Click** Install
3. **Configure** settings (see below)
4. **Start** container

#### Option B: Manual Template Installation

1. **Apps Tab** → "Add Container"
2. **Template** → Paste template URL:
   ```
   https://raw.githubusercontent.com/Abrechen2/TravStats/main/unraid-template.xml
   ```
3. **Configure** settings (see below)

---

### Step 3: Configuration

**Required Settings:**

| Setting | Value | Example |
|---------|-------|---------|
| **WebUI Port** | Choose any free port | `3000` |
| **Database Password** | Full PostgreSQL connection URL | `postgresql://flights:YOUR_PASSWORD@travstats-db:5432/flights` |
| **AppData Volume** | Path to store JWT secret | `/mnt/user/appdata/travstats` |

**Replace `YOUR_PASSWORD`** with the password you chose in Step 1!

**Optional Settings:**

| Setting | Description | Default |
|---------|-------------|---------|
| **Seed Airports** | Auto-populate 8000+ airports | `true` (recommended) |
| **AirLabs API Key** | For automatic flight lookup | (empty) |
| **OpenSky Credentials** | Fallback flight lookup | (empty) |

---

### Step 4: First Start

1. **Click** "Apply" to create the container
2. **Wait** 30-60 seconds for initial startup
3. **Check logs** for:
   ```
   ✅ JWT_SECRET validation passed
   🚀 Server running on port 8000
   ✈️  Seeding airports database...
   ✅ TravStats is ready!
   ```

4. **Access** TravStats at: `http://YOUR-UNRAID-IP:3000`

---

## 🎯 First Time Setup

1. **Open** TravStats in your browser
2. **Click** "Register" to create your account
3. **Create** a username and password
4. **Login** and start adding flights!

---

## 🔧 Configuration Options

### Environment Variables

All available environment variables (set in container config):

```bash
# Database (REQUIRED)
DATABASE_URL=postgresql://flights:password@travstats-db:5432/flights

# JWT Secret (Auto-generated if not set)
# JWT_SECRET=  # Leave empty for auto-generation

# Airport Seeding
SEED_AIRPORTS=true  # Recommended: true

# External APIs (Optional)
AIRLABS_API_KEY=  # Get free key at https://airlabs.co/
OPENSKY_CLIENT_ID=
OPENSKY_CLIENT_SECRET=

# IMAP Email Import (Advanced)
IMAP_ENABLED=false
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=your-email@gmail.com
IMAP_PASSWORD=app-specific-password
```

### Volumes

| Container Path | Host Path | Purpose |
|----------------|-----------|---------|
| `/app/data` | `/mnt/user/appdata/travstats` | JWT secret, configs |
| `/var/lib/postgresql/data` | `/mnt/user/appdata/travstats-db` | Database files |

---

## 📊 Resource Usage

**Typical Resource Consumption:**

- **RAM**: 200-400 MB (application) + 100-200 MB (database)
- **CPU**: < 5% idle, 10-20% during operations
- **Storage**:
  - Application: ~300 MB
  - Database: 50 MB + ~1-2 MB per 100 flights

---

## 🔄 Backup & Restore

### Backup Your Data

#### Database Backup (Recommended)
```bash
# From Unraid terminal
docker exec travstats-db pg_dump -U flights flights > travstats-backup-$(date +%Y%m%d).sql
```

#### Volume Backup
- Backup `/mnt/user/appdata/travstats/` (JWT secret)
- Backup `/mnt/user/appdata/travstats-db/` (full database)

### Restore from Backup

```bash
# Stop containers
docker stop travstats-app travstats-db

# Restore database
cat travstats-backup-20250124.sql | docker exec -i travstats-db psql -U flights flights

# Start containers
docker start travstats-db
docker start travstats-app
```

---

## 🐛 Troubleshooting

### Container won't start

**Check logs:**
```bash
docker logs travstats-app
```

**Common issues:**

1. **"DATABASE_URL connection failed"**
   - Verify travstats-db is running and healthy
   - Check database password matches in both containers
   - Ensure hostname is `travstats-db` (not `localhost`)

2. **"Port already in use"**
   - Change WebUI port to another free port (e.g., 3001)

3. **"JWT_SECRET validation failed"**
   - Normal on first start - auto-generates secure secret
   - If persists, check `/mnt/user/appdata/travstats/` is writable

### Can't access WebUI

1. **Check container status:** Should show "Started"
2. **Check health:** Should show "Healthy" after 60 seconds
3. **Verify port mapping:** `http://UNRAID-IP:PORT`
4. **Check firewall:** Ensure port is not blocked

### Database connection issues

```bash
# Test database connectivity
docker exec travstats-db pg_isready -U flights

# Should output: "accepting connections"
```

### Reset everything

```bash
# Stop and remove containers
docker stop travstats-app travstats-db
docker rm travstats-app travstats-db

# Delete data (⚠️ DESTRUCTIVE - you will lose all flights!)
rm -rf /mnt/user/appdata/travstats
rm -rf /mnt/user/appdata/travstats-db

# Reinstall from Step 1
```

---

## 🔐 Security Best Practices

1. **Use strong passwords** for database (min. 16 characters)
2. **Don't expose** database port externally (only TravStats needs access)
3. **Enable HTTPS** if accessing from outside your network (use reverse proxy)
4. **Regular backups** - at least weekly for important data
5. **Keep updated** - check for new TravStats versions regularly

---

## 🆙 Updating TravStats

1. **Go to** Unraid Docker tab
2. **Click** "Check for Updates"
3. **If update available:**
   - Click container name → "Force Update"
   - Or: Set "Update Container" to "Yes" and click "Apply"

4. **Automatic updates** (optional):
   - Install "Docker Auto Update" plugin
   - Configure to check for `:latest` tag

**Note:** Database migrations run automatically on container start.

---

## 💡 Tips & Tricks

### Accessing from Mobile Devices

Add to phone/tablet by visiting:
```
http://YOUR-UNRAID-IP:3000
```

For PWA-like experience, use "Add to Home Screen" in your mobile browser.

### Reverse Proxy Setup (Advanced)

Example Nginx configuration:

```nginx
server {
    listen 443 ssl;
    server_name flights.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://unraid-ip:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Performance Tuning

For large flight collections (1000+ flights):

1. **Increase database shared_buffers:**
   ```bash
   docker exec travstats-db psql -U flights -c "ALTER SYSTEM SET shared_buffers='256MB';"
   docker restart travstats-db
   ```

2. **Enable database connection pooling** (built-in via Prisma)

---

## 📚 Additional Resources

- **GitHub Repository**: https://github.com/Abrechen2/TravStats
- **Issue Tracker**: https://github.com/Abrechen2/TravStats/issues
- **Full Documentation**: See README.md in repository
- **API Documentation**: `/api/v1/` endpoints documented in code

---

## 🎉 Success!

Your TravStats installation is complete! Start tracking your flights and exploring the world! ✈️🌍

**Need help?** Open an issue on GitHub or check the troubleshooting section above.

---

*Last updated: January 2025 - Version 1.0.0*
