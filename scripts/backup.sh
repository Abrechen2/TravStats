#!/bin/bash
# TravStats Backup Script for Self-Hosters
# Backs up PostgreSQL database and uploaded files

set -e  # Exit on error

BACKUP_DIR="${BACKUP_PATH:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_BACKUP="$BACKUP_DIR/db_$TIMESTAMP.sql"
FILES_BACKUP="$BACKUP_DIR/uploads_$TIMESTAMP.tar.gz"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

echo "🏠 TravStats Self-Hosted Backup"
echo "================================"
echo "Timestamp: $TIMESTAMP"
echo "Backup directory: $BACKUP_DIR"
echo ""

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Backup PostgreSQL database
echo "📦 Backing up PostgreSQL database..."
if command -v docker-compose &> /dev/null; then
    # Using Docker Compose
    docker-compose exec -T db pg_dump -U flights flights > "$DB_BACKUP"
elif command -v docker &> /dev/null && docker ps | grep -q postgres; then
    # Using Docker directly
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') pg_dump -U flights flights > "$DB_BACKUP"
else
    # Local PostgreSQL
    pg_dump -U flights flights > "$DB_BACKUP"
fi
echo "✅ Database backed up to: $DB_BACKUP"

# Backup uploaded files (receipts, etc.)
if [ -d "backend/uploads" ]; then
    echo "📁 Backing up uploaded files..."
    tar -czf "$FILES_BACKUP" backend/uploads/
    echo "✅ Files backed up to: $FILES_BACKUP"
else
    echo "⚠️  No uploads directory found, skipping file backup"
fi

# Cleanup old backups (keep last N days)
echo "🧹 Cleaning up backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -name "db_*.sql" -mtime +$RETENTION_DAYS -delete
find "$BACKUP_DIR" -name "uploads_*.tar.gz" -mtime +$RETENTION_DAYS -delete
echo "✅ Old backups cleaned up"

echo ""
echo "✅ Backup completed successfully!"
echo "Database: $DB_BACKUP"
echo "Files: $FILES_BACKUP"
echo ""
echo "💡 Tip: Store backups offsite (USB drive, cloud storage) for safety"
