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
    echo "⚠️  Migration failed, but continuing startup..."
}

# Seed achievements if not already done
echo "🏆 Checking achievements..."
npm run seed:achievements 2>/dev/null || echo "   Achievements already seeded or failed"

# Seed airports if requested and not already done
if [ "$SEED_AIRPORTS" = "true" ]; then
    echo "✈️  Seeding airports database..."
    npm run seed:airports:csv 2>/dev/null || echo "   Airports already seeded or failed"
fi

# Create demo user if requested
if [ "$CREATE_DEMO_USER" = "true" ]; then
    echo "👤 Creating demo user..."
    npm run seed:demo 2>/dev/null || echo "   Demo user already exists or failed"
fi

echo "✅ TravStats is ready!"
echo "🌐 Web UI available on port 80"
echo "🔌 API available at /api"

# Execute the main command (supervisord)
exec "$@"
