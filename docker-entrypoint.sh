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
    # Ensure secrets directory is writable even when mounted as a volume
    chown ${NODE_UID:-1000}:${NODE_GID:-1000} "$SECRETS_DIR" 2>/dev/null || true
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
# Change to backend directory (critical - must succeed)
if ! cd /app/backend; then
    echo "[entrypoint] ❌ Error: Cannot change to /app/backend directory"
    exit 1
fi

echo "[entrypoint] Running database migrations..."

# Check if dist directory exists
if [ ! -d "/app/backend/dist" ]; then
    echo "[entrypoint] ❌ Error: /app/backend/dist directory not found!"
    echo "[entrypoint] This indicates a build problem. Please check the Docker build logs."
    exit 1
fi

# Ensure scripts directory exists
if [ ! -d "/app/backend/dist/scripts" ]; then
    echo "[entrypoint] ⚠️  Warning: /app/backend/dist/scripts directory not found, creating it..."
    mkdir -p /app/backend/dist/scripts 2>/dev/null || echo "[entrypoint] Warning: Could not create scripts directory"
fi

# Ensure Prisma Client is generated before running migrations
echo "[entrypoint] Generating Prisma Client..."
if npx prisma generate >/dev/null 2>&1; then
    echo "[entrypoint] ✅ Prisma Client generated successfully"
else
    echo "[entrypoint] ⚠️  Prisma Client generation failed"
    echo "[entrypoint] This may cause migration issues"
fi

# Run migrations with proper error handling
MIGRATION_SUCCESS=false
echo "[entrypoint] Running database migrations..."
echo "[entrypoint] This may take a moment on first run..."

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "[entrypoint] ❌ Error: DATABASE_URL is not set!"
    echo "[entrypoint] Cannot run migrations without database connection"
    MIGRATION_SUCCESS=false
else
    echo "[entrypoint] DATABASE_URL is set, proceeding with migrations..."
    
    # Test database connection before running migrations
    echo "[entrypoint] Testing database connection..."
    if node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.\$connect().then(()=>{console.log('ok');p.\$disconnect()}).catch(e=>{console.log('fail');p.\$disconnect()})" 2>/dev/null | grep -q "ok"; then
        echo "[entrypoint] ✅ Database connection test successful"
    else
        echo "[entrypoint] ⚠️  Database connection test failed"
        echo "[entrypoint] Migrations may fail, but will continue anyway"
    fi
    
    # Check if migrations directory exists
    if [ ! -d "/app/backend/prisma/migrations" ]; then
        echo "[entrypoint] ⚠️  Warning: prisma/migrations directory not found"
        echo "[entrypoint] This may be normal if migrations haven't been created yet"
    else
        MIGRATION_COUNT=$(find /app/backend/prisma/migrations -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
        echo "[entrypoint] Found $MIGRATION_COUNT migration(s) to apply"
    fi
    
    # Check for failed migrations and resolve them automatically
    # This MUST run before prisma migrate deploy, otherwise Prisma will block
    echo "[entrypoint] Checking for failed migrations..."
    set +e  # Temporarily disable exit on error
    
    # Try to check migration status - this may fail if there are failed migrations
    MIGRATION_STATUS=$(npx prisma migrate status 2>&1)
    MIGRATION_STATUS_EXIT=$?
    
    # Check if status output contains "failed" (even if exit code is non-zero)
    if echo "$MIGRATION_STATUS" | grep -qi "failed"; then
        echo "[entrypoint] ⚠️  Found failed migrations in status output, attempting to resolve automatically..."
        
        # Extract failed migration names from status output
        # Format: "The `20250120000000_add_training_config` migration started at ... failed"
        FAILED_MIGRATIONS=$(echo "$MIGRATION_STATUS" | grep -i "failed" | sed -n "s/.*\`\([^']*\)\`.*/\1/p" || echo "")
        
        if [ -n "$FAILED_MIGRATIONS" ]; then
            for MIGRATION in $FAILED_MIGRATIONS; do
                echo "[entrypoint] Resolving failed migration: $MIGRATION"
                npx prisma migrate resolve --rolled-back "$MIGRATION" 2>&1 || echo "[entrypoint] ⚠️  Could not resolve $MIGRATION (may already be resolved)"
            done
        else
            echo "[entrypoint] ⚠️  Could not extract failed migration names, trying known problematic migrations..."
            # Fallback: Try to resolve the known problematic migrations
            npx prisma migrate resolve --rolled-back 20250120000000_add_training_config 2>&1 || echo "[entrypoint] ⚠️  20250120000000 not found or already resolved"
            npx prisma migrate resolve --rolled-back 20251220000000_add_training_config 2>&1 || echo "[entrypoint] ⚠️  20251220000000 not found or already resolved"
        fi
        echo "[entrypoint] Continuing with migrations after resolving failed ones..."
    elif [ $MIGRATION_STATUS_EXIT -eq 0 ]; then
        echo "[entrypoint] ✅ No failed migrations found"
    else
        echo "[entrypoint] ⚠️  Migration status check failed (exit code: $MIGRATION_STATUS_EXIT)"
        echo "[entrypoint] This may indicate failed migrations - trying to resolve known problematic ones..."
        # Try to resolve known problematic migrations as fallback
        npx prisma migrate resolve --rolled-back 20250120000000_add_training_config 2>&1 || true
        npx prisma migrate resolve --rolled-back 20251220000000_add_training_config 2>&1 || true
        echo "[entrypoint] Continuing with migrations..."
    fi
    
    set -e  # Re-enable exit on error
    
    # Run migrations with explicit output and timeout
    # Temporarily disable set -e for migration (non-critical)
    set +e
    echo "[entrypoint] Executing: npx prisma migrate deploy"
    
    # Try to run with timeout command if available
    if command -v timeout >/dev/null 2>&1; then
        echo "[entrypoint] Running with 30 second timeout..."
        # Use timeout and explicitly flush output
        timeout 30 sh -c 'npx prisma migrate deploy' 2>&1
        MIGRATION_EXIT_CODE=$?
        if [ $MIGRATION_EXIT_CODE -eq 0 ]; then
            echo "[entrypoint] ✅ Migration completed"
        elif [ $MIGRATION_EXIT_CODE -eq 124 ]; then
            echo "[entrypoint] ⚠️  Migration timed out after 30 seconds"
            echo "[entrypoint] Continuing startup - migrations may retry on next start"
        else
            echo "[entrypoint] ⚠️  Migration failed with exit code $MIGRATION_EXIT_CODE"
        fi
    else
        # No timeout available - run directly with output flushing
        echo "[entrypoint] Running migrations (no timeout available)..."
        # Force unbuffered output by using stdbuf if available
        if command -v stdbuf >/dev/null 2>&1; then
            stdbuf -oL -eL npx prisma migrate deploy 2>&1
            MIGRATION_EXIT_CODE=$?
        else
            # Last resort - run directly
            npx prisma migrate deploy 2>&1
            MIGRATION_EXIT_CODE=$?
        fi
        
        if [ $MIGRATION_EXIT_CODE -eq 0 ]; then
            echo "[entrypoint] ✅ Migration completed"
        else
            echo "[entrypoint] ⚠️  Migration failed with exit code $MIGRATION_EXIT_CODE"
        fi
    fi
    # Re-enable set -e
    set -e
    
    # Verify migrations were actually applied
    if [ $MIGRATION_EXIT_CODE -eq 0 ]; then
        echo "[entrypoint] Migration command completed, verifying database tables..."
        sleep 1  # Give database a moment to commit
        TABLE_CHECK=$(node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.\$queryRaw\`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='_prisma_migrations'\`.then(r=>{console.log(r.length>0?'ok':'fail');p.\$disconnect()}).catch(e=>{console.log('fail');p.\$disconnect()})" 2>/dev/null || echo "fail")
        
        if [ "$TABLE_CHECK" = "ok" ]; then
            echo "[entrypoint] ✅ Migrations applied successfully"
            MIGRATION_SUCCESS=true
        else
            echo "[entrypoint] ⚠️  Migration command succeeded but tables not found"
            echo "[entrypoint] This may indicate a database connection issue"
            MIGRATION_SUCCESS=false
        fi
    else
        echo "[entrypoint] ⚠️  Migration failed with exit code $MIGRATION_EXIT_CODE"
        echo "[entrypoint] This may be normal on first run - migrations will retry on next start"
        MIGRATION_SUCCESS=false
    fi
fi

if [ "$MIGRATION_SUCCESS" = "false" ]; then
    echo "[entrypoint] ⚠️  Migrations were not successful"
    echo "[entrypoint] This may be normal on first run - migrations will retry on next start"
    echo "[entrypoint] Continuing startup - application will show better error messages if database is not ready"
fi

# Check if database tables exist before running seeds
# Only run seeds if migrations were successful
if [ "$MIGRATION_SUCCESS" = "true" ]; then
    # Verify that at least one table exists (check for _prisma_migrations table which is always created)
    TABLE_CHECK=$(node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.\$queryRaw\`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='_prisma_migrations'\`.then(r=>{console.log(r.length>0?'ok':'fail');p.\$disconnect()}).catch(e=>{console.log('fail');p.\$disconnect()})" 2>/dev/null || echo "fail")
    
    if [ "$TABLE_CHECK" = "ok" ]; then
        echo "[entrypoint] ✅ Database tables verified, proceeding with seeds"
        
        # Essential seeds - always run (idempotent)
        echo "[entrypoint] Seeding achievements..."
        if npm run seed:achievements 2>&1; then
            echo "[entrypoint] ✅ Achievements seeded successfully"
        else
            echo "[entrypoint] ⚠️  Failed to seed achievements - achievement system may not work"
            # Don't exit - this is not critical for startup
        fi
    else
        echo "[entrypoint] ⚠️  Database tables not found - skipping seeds (migrations may have failed)"
        echo "[entrypoint] Seeds will be skipped until migrations succeed"
    fi
else
    echo "[entrypoint] ⚠️  Skipping seeds - migrations were not successful"
fi

# Seed airports on first install only (if database is empty)
# Only run if migrations were successful
if [ "$MIGRATION_SUCCESS" = "true" ] && [ "$SEED_AIRPORTS" != "false" ]; then
    # Check if checkAirports.js script exists before using it
    CHECK_AIRPORTS_SCRIPT="/app/backend/dist/scripts/checkAirports.js"
    if [ -f "$CHECK_AIRPORTS_SCRIPT" ]; then
        # Check if airports already exist in database
        AIRPORT_COUNT=$(node "$CHECK_AIRPORTS_SCRIPT" 2>/dev/null || echo "0")
        if [ "$AIRPORT_COUNT" -gt 0 ] 2>/dev/null; then
            echo "[entrypoint] Airports already exist in database (${AIRPORT_COUNT} airports), skipping seed"
        else
            echo "[entrypoint] Seeding airports database (first install)..."
            npm run seed:airports:csv || echo "[entrypoint] Failed to seed airports - airports will be loaded automatically when needed"
        fi
    else
        echo "[entrypoint] Warning: checkAirports.js not found at $CHECK_AIRPORTS_SCRIPT"
        echo "[entrypoint] Proceeding with airport seed (may duplicate if airports already exist)..."
        npm run seed:airports:csv || echo "[entrypoint] Failed to seed airports - airports will be loaded automatically when needed"
    fi
elif [ "$SEED_AIRPORTS" = "false" ]; then
    echo "[entrypoint] Airport seeding disabled (SEED_AIRPORTS=false)"
else
    echo "[entrypoint] ⚠️  Skipping airport seed - migrations were not successful"
fi

# Create demo user if requested (useful for testing)
# Only run if migrations were successful
if [ "$MIGRATION_SUCCESS" = "true" ] && [ "$CREATE_DEMO_USER" = "true" ]; then
    echo "[entrypoint] Creating demo user with sample data..."
    if npm run seed:demo 2>&1; then
        echo "[entrypoint] ✅ Demo user created successfully"
    else
        echo "[entrypoint] ⚠️  Demo user already exists or creation failed"
    fi
elif [ "$CREATE_DEMO_USER" = "true" ]; then
    echo "[entrypoint] ⚠️  Skipping demo user creation - migrations were not successful"
fi

echo "[entrypoint] TravStats is ready (nginx on :80, backend on :8000)"

# Execute the main command (supervisord)
exec "$@"
