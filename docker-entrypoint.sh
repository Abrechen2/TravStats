#!/bin/sh
set -e

echo "🚀 Starting TravStats..."

# Auto-generate JWT_SECRET if not set
if [ -z "$JWT_SECRET" ]; then
    JWT_SECRET_FILE="/app/data/jwt_secret"

    if [ -f "$JWT_SECRET_FILE" ]; then
        echo "📝 Loading existing JWT_SECRET..."
        export JWT_SECRET=$(cat "$JWT_SECRET_FILE")
    else
        echo "🔐 Generating new JWT_SECRET..."
        export JWT_SECRET=$(openssl rand -hex 32)
        echo "$JWT_SECRET" > "$JWT_SECRET_FILE"
        chmod 600 "$JWT_SECRET_FILE"
        echo "✅ JWT_SECRET generated and saved"
    fi
fi

# Wait for database to be ready
if [ -n "$DATABASE_URL" ]; then
    echo "⏳ Waiting for database..."

    # Extract host and port from DATABASE_URL
    # Format: postgresql://user:pass@host:port/database
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
        echo "❌ Database connection timeout"
        exit 1
    fi

    echo "✅ Database is ready"
fi

# Run database migrations
cd /app/backend
echo "📦 Running database migrations..."
npx prisma migrate deploy || {
    echo "❌ Migration failed!"
    echo "   This might be the first run. Continuing..."
}

# Essential seeds - always run (idempotent)
echo ""
echo "🌱 Running essential initialization..."

# Seed achievements (required for achievement system to work)
echo "🏆 Seeding achievements..."
if npm run seed:achievements; then
    echo "   ✅ Achievements ready"
else
    echo "   ❌ Failed to seed achievements - achievement system may not work!"
fi

# Optional seeds based on environment variables
if [ "$SEED_AIRPORTS" = "true" ]; then
    echo "✈️  Seeding airports database..."
    if npm run seed:airports:csv; then
        echo "   ✅ Airports database ready"
    else
        echo "   ⚠️  Failed to seed airports - autocomplete may not work"
    fi
fi

# Create demo user if requested (useful for testing)
if [ "$CREATE_DEMO_USER" = "true" ]; then
    echo "👤 Creating demo user with sample data..."
    if npm run seed:demo; then
        echo "   ✅ Demo user ready (username: demo, password: demo123)"
    else
        echo "   ⚠️  Demo user already exists or creation failed"
    fi
fi

echo ""

echo "✅ TravStats is ready!"
echo "🌐 Web UI available on port 80"
echo "🔌 API available at /api"

# Execute the main command (supervisord)
exec "$@"
