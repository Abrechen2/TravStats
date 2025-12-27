#!/bin/bash
# Script to fix failed Prisma migrations
# This resolves failed migrations and runs migrations again

set -e

echo "🔧 Fixing Prisma migrations..."

# Determine container name
CONTAINER_NAME="travstats-app"
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "✅ Found container: $CONTAINER_NAME"
else
    echo "❌ Container $CONTAINER_NAME not found"
    echo "Available containers:"
    docker ps --format '{{.Names}}'
    exit 1
fi

# Step 1: Check migration status
echo ""
echo "📊 Checking migration status..."
docker exec $CONTAINER_NAME sh -c "cd /app/backend && npx prisma migrate status" || true

# Step 2: Resolve failed migrations
echo ""
echo "🔧 Resolving failed migrations..."
docker exec $CONTAINER_NAME sh -c "cd /app/backend && npx prisma migrate resolve --rolled-back 20250120000000_add_training_config" || echo "⚠️  Could not resolve 20250120000000 (may not exist)"
docker exec $CONTAINER_NAME sh -c "cd /app/backend && npx prisma migrate resolve --rolled-back 20251220000000_add_training_config" || echo "⚠️  Could not resolve 20251220000000 (may not exist)"

# Step 3: Generate Prisma client
echo ""
echo "🔨 Generating Prisma client..."
docker exec $CONTAINER_NAME sh -c "cd /app/backend && npx prisma generate"

# Step 4: Run migrations
echo ""
echo "🚀 Running migrations..."
docker exec $CONTAINER_NAME sh -c "cd /app/backend && npx prisma migrate deploy"

# Step 5: Verify migrations
echo ""
echo "✅ Verifying migrations..."
docker exec $CONTAINER_NAME sh -c "cd /app/backend && npx prisma migrate status"

echo ""
echo "✅ Migration fix complete!"

