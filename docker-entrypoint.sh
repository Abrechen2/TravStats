#!/bin/sh
set -e

echo "[entrypoint] Starting TravStats..."

# Ensure data directory structure exists with proper permissions
echo "[entrypoint] Ensuring data directory structure..."
# Create directories if they don't exist
mkdir -p /app/data/logs 2>/dev/null || echo "[entrypoint] Warning: Could not create /app/data/logs (may be permission issue)"
mkdir -p /app/data/backups 2>/dev/null || echo "[entrypoint] Warning: Could not create /app/data/backups (may be permission issue)"

# Get node user UID/GID (usually 1000:1000 in node images)
NODE_UID=$(id -u node 2>/dev/null || echo "1000")
NODE_GID=$(id -g node 2>/dev/null || echo "1000")

# Try to set ownership and permissions (may fail if volume is mounted from host with different permissions)
# This works if we have write access to the parent directory
if [ -w /app/data ] 2>/dev/null; then
    echo "[entrypoint] Setting permissions for /app/data..."
    chown -R ${NODE_UID}:${NODE_GID} /app/data 2>/dev/null || true
    chmod -R 755 /app/data 2>/dev/null || true
    # Ensure logs directory is writable
    chmod 777 /app/data/logs 2>/dev/null || true
    # Ensure backups directory is writable
    chmod 755 /app/data/backups 2>/dev/null || true
    echo "[entrypoint] Permissions set successfully"
else
    echo "[entrypoint] Warning: Cannot write to /app/data (volume may be mounted from host)"
    echo "[entrypoint] Logging to files may be disabled - using console only"
fi

# Auto-generate JWT_SECRET if not set
# Store in /app/secrets (not in /app/data) to prevent exposure via mounted volumes
if [ -z "$JWT_SECRET" ]; then
    SECRETS_DIR="/app/secrets"
    mkdir -p "$SECRETS_DIR" 2>/dev/null || echo "[entrypoint] Warning: Could not create $SECRETS_DIR"
    chmod 700 "$SECRETS_DIR" 2>/dev/null || true
    JWT_SECRET_FILE="$SECRETS_DIR/jwt.secret"
    OLD_JWT_SECRET_FILE="/app/data/jwt.secret"
    OLD_JWT_SECRET_FILE_ALT="/app/data/jwt_secret"
    
    # Migrate from old location if it exists (for backward compatibility)
    if [ -f "$OLD_JWT_SECRET_FILE" ] && [ ! -f "$JWT_SECRET_FILE" ]; then
        echo "[entrypoint] Migrating JWT_SECRET from old location..."
        mv "$OLD_JWT_SECRET_FILE" "$JWT_SECRET_FILE"
        chmod 600 "$JWT_SECRET_FILE"
        echo "[entrypoint] JWT_SECRET migrated successfully"
    elif [ -f "$OLD_JWT_SECRET_FILE_ALT" ] && [ ! -f "$JWT_SECRET_FILE" ]; then
        echo "[entrypoint] Migrating JWT_SECRET from old filename..."
        mv "$OLD_JWT_SECRET_FILE_ALT" "$JWT_SECRET_FILE"
        chmod 600 "$JWT_SECRET_FILE"
        echo "[entrypoint] JWT_SECRET migrated successfully"
    fi

    if [ -f "$JWT_SECRET_FILE" ]; then
        echo "[entrypoint] Loading existing JWT_SECRET..."
        JWT_SECRET=$(cat "$JWT_SECRET_FILE")
        export JWT_SECRET
    else
        echo "[entrypoint] Generating new JWT_SECRET..."
        JWT_SECRET=$(openssl rand -hex 32)
        export JWT_SECRET
        echo "$JWT_SECRET" > "$JWT_SECRET_FILE"
        chmod 600 "$JWT_SECRET_FILE"
        echo "[entrypoint] JWT_SECRET generated and saved"
    fi
fi

# Wait for database to be ready
if [ -n "$DATABASE_URL" ]; then
    echo "[entrypoint] Waiting for database..."

    # Extract host and port from DATABASE_URL (format: postgresql://user:pass@host:port/database)
    # Handle both IP addresses and hostnames
    DB_HOST=$(echo "$DATABASE_URL" | sed -e 's|.*@\([^:]*\):.*|\1|' | sed -e 's|/.*||')
    DB_PORT=$(echo "$DATABASE_URL" | sed -e 's|.*:\([0-9]*\)/.*|\1|' | sed -e 's|/.*||')
    
    # Fallback to default port if extraction failed
    if [ -z "$DB_PORT" ] || [ "$DB_PORT" = "$DATABASE_URL" ]; then
        DB_PORT="5432"
    fi

    echo "[entrypoint] Connecting to database at $DB_HOST:$DB_PORT..."

    max_retries=30
    retry_count=0

    until nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null || [ $retry_count -eq $max_retries ]; do
        retry_count=$((retry_count + 1))
        echo "   Database not ready yet (attempt $retry_count/$max_retries)..."
        sleep 2
    done

    if [ $retry_count -eq $max_retries ]; then
        echo "[entrypoint] ❌ Database connection timeout after $max_retries attempts"
        echo "[entrypoint] Please check:"
        echo "[entrypoint]   1. Database container is running"
        echo "[entrypoint]   2. DATABASE_URL is correct: $DATABASE_URL"
        echo "[entrypoint]   3. Network connectivity to $DB_HOST:$DB_PORT"
        exit 1
    fi

    echo "[entrypoint] ✅ Database is ready"
else
    echo "[entrypoint] ⚠️  Warning: DATABASE_URL not set, skipping database wait"
fi

# Run database migrations
cd /app/backend
echo "[entrypoint] Running database migrations..."
if npx prisma migrate deploy; then
    echo "[entrypoint] ✅ Migrations applied successfully"
else
    echo "[entrypoint] ⚠️  Migration failed or database not ready"
    echo "[entrypoint] This may be normal on first run - migrations will retry on next start"
    # Don't exit - let the application try to connect and show better error messages
fi

# Essential seeds - always run (idempotent)
echo "[entrypoint] Seeding achievements..."
npm run seed:achievements || echo "[entrypoint] Failed to seed achievements - achievement system may not work"

# Seed airports on first install only (if database is empty)
# Skip if explicitly disabled, otherwise check if airports exist
if [ "$SEED_AIRPORTS" != "false" ]; then
    # Check if airports already exist in database
    AIRPORT_COUNT=$(node dist/scripts/checkAirports.js 2>/dev/null || echo "0")
    if [ "$AIRPORT_COUNT" -gt 0 ] 2>/dev/null; then
        echo "[entrypoint] Airports already exist in database (${AIRPORT_COUNT} airports), skipping seed"
    else
        echo "[entrypoint] Seeding airports database (first install)..."
        npm run seed:airports:csv || echo "[entrypoint] Failed to seed airports - airports will be loaded automatically when needed"
    fi
else
    echo "[entrypoint] Airport seeding disabled (SEED_AIRPORTS=false)"
fi

# Create demo user if requested (useful for testing)
if [ "$CREATE_DEMO_USER" = "true" ]; then
    echo "[entrypoint] Creating demo user with sample data..."
    npm run seed:demo || echo "[entrypoint] Demo user already exists or creation failed"
fi

echo "[entrypoint] TravStats is ready (nginx on :80, backend on :8000)"

# Execute the main command (supervisord)
exec "$@"
