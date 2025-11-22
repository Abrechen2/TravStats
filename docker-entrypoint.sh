#!/bin/sh
set -e

echo "🚀 Starting TravStats..."

# Wait for database to be ready
if [ -n "$DATABASE_URL" ]; then
    echo "⏳ Waiting for database..."
    max_retries=30
    retry_count=0

    until wget --spider -q "$DATABASE_URL" 2>/dev/null || [ $retry_count -eq $max_retries ]; do
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

echo "✅ TravStats is ready!"
echo "🌐 Web UI available on port 80"
echo "🔌 API available at /api"

# Execute the main command (supervisord)
exec "$@"
