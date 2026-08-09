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

# Persist user uploads on the data volume (issue #152)
# The backend writes uploads (receipts, trip photos, parser emails, training
# samples) to /app/backend/uploads via path.join(__dirname, '../../uploads').
# That path lives in the container's ephemeral layer and is wiped on every
# image update, so uploads vanished after each container recreation. Relocate
# it onto the mounted /app/data volume with a symlink so uploads survive
# updates out of the box — no extra manual bind-mount required. This runs
# before supervisord starts the backend, so the symlink is in place before the
# app's ensureUploadDir() creates its receipts/emails/trip-photos subfolders.
UPLOADS_LINK="/app/backend/uploads"
UPLOADS_TARGET="/app/data/uploads"
if mkdir -p "$UPLOADS_TARGET" 2>/dev/null; then
    chown "${NODE_UID:-1000}:${NODE_GID:-1000}" "$UPLOADS_TARGET" 2>/dev/null || true
    if [ -L "$UPLOADS_LINK" ]; then
        echo "[entrypoint] ✅ Uploads already persisted on the data volume (symlink present)"
    elif [ -e "$UPLOADS_LINK" ]; then
        # A real directory already exists — an operator bind-mounted
        # /app/backend/uploads themselves (the documented pre-#152 workaround).
        # Their data already persists there, so leave the mount untouched
        # rather than risk clobbering it.
        echo "[entrypoint] Uploads path is an existing directory (operator bind-mount) — leaving it in place"
    elif ln -s "$UPLOADS_TARGET" "$UPLOADS_LINK" 2>/dev/null; then
        echo "[entrypoint] ✅ Uploads symlinked onto the data volume ($UPLOADS_TARGET)"
    else
        echo "[entrypoint] ⚠️  Could not create uploads symlink — uploads may not persist across updates"
    fi
else
    echo "[entrypoint] ⚠️  Could not create $UPLOADS_TARGET — uploads will use the ephemeral container layer"
fi

# Auto-generate JWT_SECRET if not set
# Store in /app/data/secrets (single volume, see resolveSecretsDir in jwtSecret.ts).
# Legacy paths (/app/secrets from pre-1.0 installs, root-of-data from pre-0.2)
# are migrated once on boot so existing installs keep their secret.
if [ -z "$JWT_SECRET" ]; then
    SECRETS_DIR="/app/data/secrets"
    JWT_SECRET_FILE="$SECRETS_DIR/jwt.secret"
    LEGACY_SECRETS_DIR="/app/secrets"
    LEGACY_JWT_SECRET_FILE="$LEGACY_SECRETS_DIR/jwt.secret"
    OLD_JWT_SECRET_FILE="/app/data/jwt.secret"
    OLD_JWT_SECRET_FILE_ALT="/app/data/jwt_secret"

    # Ensure secrets directory exists and is writable
    if ! mkdir -p "$SECRETS_DIR" 2>/dev/null; then
        echo "[entrypoint] ❌ Error: Could not create $SECRETS_DIR"
        echo "[entrypoint] This is required for JWT secret persistence. Please check volume permissions."
        exit 1
    fi

    # Check if secrets directory is writable
    if [ ! -w "$SECRETS_DIR" ]; then
        echo "[entrypoint] ❌ Error: $SECRETS_DIR is not writable"
        echo "[entrypoint] JWT secret cannot be persisted. Please check volume permissions."
        exit 1
    fi

    # Ensure secrets directory has correct permissions
    chown ${NODE_UID:-1000}:${NODE_GID:-1000} "$SECRETS_DIR" 2>/dev/null || true
    chmod 700 "$SECRETS_DIR" 2>/dev/null || true

    # Migrate from legacy locations if they exist (backward compatibility)
    # Order: check /app/secrets/jwt.secret first (most recent layout), then the pre-0.2 paths.
    if [ -f "$LEGACY_JWT_SECRET_FILE" ] && [ ! -f "$JWT_SECRET_FILE" ]; then
        echo "[entrypoint] Migrating JWT_SECRET from legacy /app/secrets/..."
        cp -p "$LEGACY_JWT_SECRET_FILE" "$JWT_SECRET_FILE"
        chmod 600 "$JWT_SECRET_FILE"
        echo "[entrypoint] JWT_SECRET migrated successfully"
    elif [ -f "$OLD_JWT_SECRET_FILE" ] && [ ! -f "$JWT_SECRET_FILE" ]; then
        echo "[entrypoint] Migrating JWT_SECRET from /app/data/jwt.secret..."
        mv "$OLD_JWT_SECRET_FILE" "$JWT_SECRET_FILE"
        chmod 600 "$JWT_SECRET_FILE"
        echo "[entrypoint] JWT_SECRET migrated successfully"
    elif [ -f "$OLD_JWT_SECRET_FILE_ALT" ] && [ ! -f "$JWT_SECRET_FILE" ]; then
        echo "[entrypoint] Migrating JWT_SECRET from /app/data/jwt_secret..."
        mv "$OLD_JWT_SECRET_FILE_ALT" "$JWT_SECRET_FILE"
        chmod 600 "$JWT_SECRET_FILE"
        echo "[entrypoint] JWT_SECRET migrated successfully"
    fi

    # Function to validate JWT secret (minimum 32 hex characters = 64 chars total)
    validate_jwt_secret() {
        local secret="$1"
        if [ -z "$secret" ]; then
            return 1
        fi
        # Check minimum length (64 hex chars = 32 bytes)
        if [ ${#secret} -lt 64 ]; then
            return 1
        fi
        # Check if it's valid hex (only contains 0-9a-f)
        if ! echo "$secret" | grep -qE '^[0-9a-fA-F]+$'; then
            return 1
        fi
        return 0
    }

    if [ -f "$JWT_SECRET_FILE" ]; then
        echo "[entrypoint] Loading existing JWT_SECRET from $JWT_SECRET_FILE..."
        JWT_SECRET=$(cat "$JWT_SECRET_FILE" | tr -d '[:space:]')

        # Validate loaded secret
        if ! validate_jwt_secret "$JWT_SECRET"; then
            echo "[entrypoint] ❌ Error: Existing JWT_SECRET in $JWT_SECRET_FILE is invalid"
            echo "[entrypoint] Secret must be at least 64 hex characters (32 bytes)"
            echo "[entrypoint] Please delete the file or set JWT_SECRET environment variable to fix this."
            exit 1
        fi

        export JWT_SECRET
        echo "[entrypoint] ✅ JWT_SECRET loaded successfully (${#JWT_SECRET} characters)"
    else
        echo "[entrypoint] Generating new JWT_SECRET..."
        JWT_SECRET=$(openssl rand -hex 32)

        # Validate generated secret
        if ! validate_jwt_secret "$JWT_SECRET"; then
            echo "[entrypoint] ❌ Error: Generated JWT_SECRET failed validation"
            exit 1
        fi

        # Save to file
        if ! echo "$JWT_SECRET" > "$JWT_SECRET_FILE"; then
            echo "[entrypoint] ❌ Error: Could not write JWT_SECRET to $JWT_SECRET_FILE"
            echo "[entrypoint] Please check write permissions for $SECRETS_DIR"
            exit 1
        fi

        chmod 600 "$JWT_SECRET_FILE"
        export JWT_SECRET
        echo "[entrypoint] ✅ JWT_SECRET generated and saved to $JWT_SECRET_FILE"
    fi
else
    echo "[entrypoint] Using JWT_SECRET from environment variable"
    # Validate environment variable secret
    if [ ${#JWT_SECRET} -lt 64 ] || ! echo "$JWT_SECRET" | grep -qE '^[0-9a-fA-F]+$'; then
        echo "[entrypoint] ⚠️  Warning: JWT_SECRET from environment may be weak (should be at least 64 hex characters)"
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
        MASKED_URL=$(echo "$DATABASE_URL" | sed -E 's|(://[^:]+:)[^@]+(@)|\1****\2|')
        echo "[entrypoint]   2. DATABASE_URL is correct: $MASKED_URL"
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
        # A non-zero exit from `migrate status` is the NORMAL result whenever
        # migrations are pending — including a completely empty database on
        # first boot. It does not mean anything failed, and the branch above
        # already catches every case where the output actually says "failed".
        #
        # This branch used to roll back two known-problematic migrations
        # regardless. On a fresh install there is no `_prisma_migrations`
        # table yet, so both calls died with
        #   Invariant violation: called markMigrationRolledBack on a database
        #   without migrations table
        # printing two red Rust stack traces on the very first start of every
        # new installation, before anything had gone wrong at all (#234).
        #
        # Nothing is resolved here any more: with no "failed" in the status
        # output there is, by definition, nothing to roll back.
        echo "[entrypoint] Migration status exited $MIGRATION_STATUS_EXIT (normal when migrations are pending)"
        echo "[entrypoint] No failed migrations reported - continuing with migrations..."
    fi

    set -e  # Re-enable exit on error

    # Pre-migration backup hook (major-version bumps only).
    # Compares /app/data/backups/last-version with the version we're about
    # to start. On a major bump (e.g. 1.x -> 2.x) snapshots the DB to
    # /app/data/backups/pre-vX-upgrade-<ts>.sql before any migration runs.
    # Soft-fails: if the backup itself errors, the script logs and exits 0
    # so the migration is never blocked. The migration remains the bottleneck.
    PRE_MIGRATION_BACKUP_SCRIPT="/app/backend/dist/scripts/preMigrationBackup.js"
    if [ -f "$PRE_MIGRATION_BACKUP_SCRIPT" ]; then
        echo "[entrypoint] Checking upgrade-backup trigger..."
        set +e
        node "$PRE_MIGRATION_BACKUP_SCRIPT" 2>&1
        PRE_MIGRATION_BACKUP_EXIT=$?
        set -e
        if [ $PRE_MIGRATION_BACKUP_EXIT -ne 0 ]; then
            echo "[entrypoint] ⚠️  Pre-migration backup hook exited with $PRE_MIGRATION_BACKUP_EXIT — continuing"
        fi
    else
        echo "[entrypoint] ⚠️  $PRE_MIGRATION_BACKUP_SCRIPT not found — skipping upgrade-backup check"
    fi

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

            # Persist the version that successfully migrated this data volume.
            # Read on the next boot by the upgrade-backup hook to detect
            # future major bumps. APP_VERSION wins over BUILD_VERSION wins
            # over /app/backend/VERSION (matches getCurrentVersion() in
            # backend/src/utils/upgradeBackup.ts).
            LAST_VERSION_FILE="/app/data/backups/last-version"
            if [ -n "$APP_VERSION" ]; then
                CURRENT_VERSION="$APP_VERSION"
            elif [ -n "$BUILD_VERSION" ]; then
                CURRENT_VERSION="$BUILD_VERSION"
            elif [ -f "/app/backend/VERSION" ]; then
                CURRENT_VERSION=$(cat /app/backend/VERSION | tr -d '[:space:]')
            else
                CURRENT_VERSION="unknown"
            fi
            if [ -n "$CURRENT_VERSION" ] && [ "$CURRENT_VERSION" != "unknown" ]; then
                mkdir -p /app/data/backups 2>/dev/null || true
                if echo -n "$CURRENT_VERSION" > "$LAST_VERSION_FILE" 2>/dev/null; then
                    chmod 644 "$LAST_VERSION_FILE" 2>/dev/null || true
                    echo "[entrypoint] ✅ Wrote last-version marker: $CURRENT_VERSION"
                else
                    echo "[entrypoint] ⚠️  Could not write $LAST_VERSION_FILE — next boot may re-trigger upgrade backup"
                fi
            fi
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

        # Note: Achievements are core features defined in code, not seeded from database
        # They are automatically ensured when needed via ensureAchievements() function
    else
        echo "[entrypoint] ⚠️  Database tables not found - skipping seeds (migrations may have failed)"
        echo "[entrypoint] Seeds will be skipped until migrations succeed"
    fi
else
    echo "[entrypoint] ⚠️  Skipping seeds - migrations were not successful"
fi

# Backfill flight time semantics (canonical-UTC migration, 1.2.0)
# Idempotent: only touches rows where dep_time_semantics or arr_time_semantics
# is still 'UNKNOWN'. After every row is classified once, subsequent boots
# return 0 rows from the WHERE clause and finish in milliseconds.
# Disable with TIMESEMANTICS_AUTO_BACKFILL=false (manual SSH still works).
if [ "$MIGRATION_SUCCESS" = "true" ] && [ "$TIMESEMANTICS_AUTO_BACKFILL" != "false" ]; then
    BACKFILL_SCRIPT="/app/backend/dist/scripts/backfillTimeSemantics.js"
    if [ -f "$BACKFILL_SCRIPT" ]; then
        echo "[entrypoint] Running flight time-semantics backfill..."
        set +e
        node "$BACKFILL_SCRIPT" --apply 2>&1
        BACKFILL_EXIT=$?
        set -e
        if [ $BACKFILL_EXIT -eq 0 ]; then
            echo "[entrypoint] ✅ Time-semantics backfill complete"
        else
            echo "[entrypoint] ⚠️  Time-semantics backfill exited with $BACKFILL_EXIT — continuing (rows stay UNKNOWN; safe no-op for the scheduler)"
        fi
    else
        echo "[entrypoint] ⚠️  $BACKFILL_SCRIPT not found — skipping time-semantics backfill"
    fi
elif [ "$TIMESEMANTICS_AUTO_BACKFILL" = "false" ]; then
    echo "[entrypoint] Time-semantics auto-backfill disabled (TIMESEMANTICS_AUTO_BACKFILL=false)"
fi

# Backfill cruise leg distances (Hybrid distance pipeline, 1.3.x)
# Recomputes cruise_legs for cruises with no rows or stale router_version.
# Idempotent — up-to-date cruises are skipped without DB writes.
# Disable with CRUISE_LEGS_AUTO_BACKFILL=false.
if [ "$MIGRATION_SUCCESS" = "true" ] && [ "$CRUISE_LEGS_AUTO_BACKFILL" != "false" ]; then
    CRUISE_BACKFILL_SCRIPT="/app/backend/dist/scripts/backfillCruiseLegs.js"
    if [ -f "$CRUISE_BACKFILL_SCRIPT" ]; then
        echo "[entrypoint] Running cruise leg distance backfill..."
        set +e
        node "$CRUISE_BACKFILL_SCRIPT" --apply 2>&1
        CRUISE_EXIT=$?
        set -e
        if [ $CRUISE_EXIT -eq 0 ]; then
            echo "[entrypoint] ✅ Cruise leg backfill complete"
        else
            echo "[entrypoint] ⚠️  Cruise leg backfill exited with $CRUISE_EXIT — continuing (stats fall back to inline haversine)"
        fi
    else
        echo "[entrypoint] ⚠️  $CRUISE_BACKFILL_SCRIPT not found — skipping cruise leg backfill"
    fi
elif [ "$CRUISE_LEGS_AUTO_BACKFILL" = "false" ]; then
    echo "[entrypoint] Cruise leg auto-backfill disabled (CRUISE_LEGS_AUTO_BACKFILL=false)"
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

# Backfill closed airports for installs whose initial seed (pre-1.4) only
# imported active airports — TXL, THF, Stapleton, etc. are otherwise
# missing from the search dropdown. Idempotent: skips if any closed
# airport is already present, so safe to run on every boot. Disable with
# CLOSED_AIRPORT_BACKFILL=false.
if [ "$MIGRATION_SUCCESS" = "true" ] && [ "$CLOSED_AIRPORT_BACKFILL" != "false" ]; then
    BACKFILL_CLOSED_SCRIPT="/app/backend/dist/scripts/backfillClosedAirports.js"
    if [ -f "$BACKFILL_CLOSED_SCRIPT" ]; then
        echo "[entrypoint] Checking closed-airport backfill..."
        set +e
        node "$BACKFILL_CLOSED_SCRIPT" 2>&1
        BACKFILL_CLOSED_EXIT=$?
        set -e
        if [ $BACKFILL_CLOSED_EXIT -eq 0 ]; then
            echo "[entrypoint] ✅ Closed-airport backfill check complete"
        else
            echo "[entrypoint] ⚠️  Closed-airport backfill exited with $BACKFILL_CLOSED_EXIT — continuing (closed airports may be missing; admin can trigger reseed manually)"
        fi
    else
        echo "[entrypoint] ⚠️  $BACKFILL_CLOSED_SCRIPT not found — skipping closed-airport backfill"
    fi
elif [ "$CLOSED_AIRPORT_BACKFILL" = "false" ]; then
    echo "[entrypoint] Closed-airport backfill disabled (CLOSED_AIRPORT_BACKFILL=false)"
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

# Final ownership reconciliation — the seed scripts above (airports, demo user,
# achievements) run with the entrypoint's effective UID (root in standard
# installs) and create files like /app/data/logs/app.log owned root:root. The
# supervised backend then runs as `node` (uid 1000) and would fail with EACCES
# on those files. Re-chown after the as-root phase finishes so the long-running
# process can write its logs. Idempotent — safe even if files were already
# correctly owned.
if [ -d /app/data ] && [ -w /app/data ]; then
    chown -R ${NODE_UID:-1000}:${NODE_GID:-1000} /app/data 2>/dev/null || true
fi

# Execute the main command (supervisord)
exec "$@"
