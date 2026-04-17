# TravStats Deployment Scripts

Self-hosting helper scripts for easy setup and maintenance.

## 📦 setup.sh - One-Command Setup

Automatically sets up your TravStats instance with all required configuration.

```bash
./scripts/setup.sh
```

**What it does:**
- ✅ Checks for Docker installation (installs if needed)
- ✅ Generates secure JWT secret and database password
- ✅ Creates `.env` configuration files
- ✅ Starts all Docker services
- ✅ Runs database migrations
- ✅ Seeds airports and achievements

**After setup:**
1. Open http://localhost:3000
2. Create your admin account (first user)
3. Invite family/friends via Admin Panel

---

## 💾 backup.sh - Automated Backups

Creates backups of your database and uploaded files.

```bash
./scripts/backup.sh
```

**What it backs up:**
- PostgreSQL database (all flights, users, achievements)
- Uploaded files (receipts, etc.)

**Configuration (via environment variables):**
```bash
BACKUP_PATH=./backups           # Where to store backups
BACKUP_RETENTION_DAYS=30        # How long to keep old backups
```

**Recommended usage:**
```bash
# Run daily via cron
0 2 * * * /path/to/TravStats/scripts/backup.sh
```

**Example output:**
```
./backups/
├── db_20251128_020000.sql
├── db_20251127_020000.sql
├── uploads_20251128_020000.tar.gz
└── uploads_20251127_020000.tar.gz
```

---

## 🔄 Restore from Backup

### Database restore:
```bash
# Using Docker Compose
cat backups/db_20251128_020000.sql | docker-compose exec -T db psql -U flights flights

# Using Docker directly
cat backups/db_20251128_020000.sql | docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U flights flights

# Local PostgreSQL
psql -U flights flights < backups/db_20251128_020000.sql
```

### Files restore:
```bash
tar -xzf backups/uploads_20251128_020000.tar.gz
```

---

## 💡 Best Practices

### For Home Network:
```bash
# Run setup
./scripts/setup.sh

# Access locally
http://192.168.1.X:3000
```

### For VPN/Tailscale:
```bash
# After setup, access via Tailscale IP
http://100.64.0.X:3000
```

### For Public Domain:
1. Run setup.sh
2. Configure reverse proxy (Nginx) with SSL and make sure it sends `X-Forwarded-Proto: https` (then `COOKIE_SECURE` auto-detects)
3. Set `CORS_ORIGIN` in `.env` only if the frontend lives on a different hostname than the API (same-origin behind a proxy needs no setting)
4. Enter the public URL once in the setup wizard — it's stored in the DB, not in `.env`

See main README.md for detailed deployment options.

---

## 🆘 Troubleshooting

**Docker not found:**
```bash
curl -fsSL https://get.docker.com | sh
```

**Services won't start:**
```bash
docker-compose down -v
docker-compose up -d
```

**Database migration fails:**
```bash
docker-compose exec backend npx prisma generate
docker-compose exec backend npx prisma migrate deploy
```

**Backup fails:**
```bash
# Check if database is running
docker-compose ps

# Check logs
docker-compose logs db
```
