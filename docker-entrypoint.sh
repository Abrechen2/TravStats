#!/bin/sh
set -e

echo "[entrypoint] Starting TravStats..."

# Auto-generate JWT_SECRET if not set
if [ -z "$JWT_SECRET" ]; then
    JWT_SECRET_FILE="/app/data/jwt_secret"

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
    DB_HOST=$(echo "$DATABASE_URL" | sed -e 's|.*@\(.*\):.*|\1|')
    DB_PORT=$(echo "$DATABASE_URL" | sed -e 's|.*:\([0-9]*\)/.*|\1|')

    max_retries=30
    retry_count=0

    until nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null || [ $retry_count -eq $max_retries ]; do
        retry_count=$((retry_count + 1))
        echo "   Database not ready yet (attempt $retry_count/$max_retries)..."
        sleep 2
    done

    if [ $retry_count -eq $max_retries ]; then
        echo "[entrypoint] Database connection timeout"
        exit 1
    fi

    echo "[entrypoint] Database is ready"
fi

# Run database migrations
cd /app/backend
echo "[entrypoint] Running database migrations..."
npx prisma migrate deploy || {
    echo "[entrypoint] Migration failed (continuing, maybe first run)"
}

# Essential seeds - always run (idempotent)
echo "[entrypoint] Seeding achievements..."
npm run seed:achievements || echo "[entrypoint] Failed to seed achievements - achievement system may not work"

# Optional seeds based on environment variables
if [ "$SEED_AIRPORTS" = "true" ]; then
    echo "[entrypoint] Seeding airports database..."
    npm run seed:airports:csv || echo "[entrypoint] Failed to seed airports - autocomplete may not work"
fi

# Create demo user if requested (useful for testing)
if [ "$CREATE_DEMO_USER" = "true" ]; then
    echo "[entrypoint] Creating demo user with sample data..."
    npm run seed:demo || echo "[entrypoint] Demo user already exists or creation failed"
fi

echo "[entrypoint] TravStats is ready (nginx on :80, backend on :8000)"

# Execute the main command (supervisord)
exec "$@"
