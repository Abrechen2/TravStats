-- CreateTable
CREATE TABLE "pending_flight_updates" (
    "id" TEXT NOT NULL,
    "flight_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "original_data" JSONB NOT NULL,
    "proposed_data" JSONB NOT NULL,
    "edited_data" JSONB,
    "changes" JSONB NOT NULL,
    "edited_changes" JSONB,
    "api_source" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "applied_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "edited_at" TIMESTAMP(3),
    "statistics_impact" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_flight_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_update_statistics" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "total_updates" INTEGER NOT NULL DEFAULT 0,
    "applied_updates" INTEGER NOT NULL DEFAULT 0,
    "rejected_updates" INTEGER NOT NULL DEFAULT 0,
    "edited_updates" INTEGER NOT NULL DEFAULT 0,
    "expired_updates" INTEGER NOT NULL DEFAULT 0,
    "most_changed_fields" JSONB NOT NULL,
    "average_update_time" DOUBLE PRECISION,
    "last_updated" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_update_statistics_pkey" PRIMARY KEY ("id")
);

-- AlterTable (only if flights table exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'flights') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'flights' AND column_name = 'flight_number') THEN
            ALTER TABLE "flights" ADD COLUMN "flight_number" TEXT;
        END IF;
    END IF;
END $$;

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "auto_update_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "auto_update_require_approval" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "auto_update_check_interval" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN IF NOT EXISTS "auto_update_only_during_flight" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "auto_update_expiry_hours" INTEGER NOT NULL DEFAULT 24;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pending_flight_updates_user_id_idx" ON "pending_flight_updates"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pending_flight_updates_flight_id_idx" ON "pending_flight_updates"("flight_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pending_flight_updates_status_idx" ON "pending_flight_updates"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pending_flight_updates_expires_at_idx" ON "pending_flight_updates"("expires_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pending_flight_updates_created_at_idx" ON "pending_flight_updates"("created_at");

-- CreateIndex (only if flights table exists and column exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'flights') THEN
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'flights' AND column_name = 'flight_number') THEN
            IF NOT EXISTS (SELECT FROM pg_indexes WHERE indexname = 'flights_flight_number_idx') THEN
                CREATE INDEX "flights_flight_number_idx" ON "flights"("flight_number");
            END IF;
        END IF;
    END IF;
END $$;

-- CreateUniqueIndex
CREATE UNIQUE INDEX IF NOT EXISTS "pending_update_statistics_user_id_key" ON "pending_update_statistics"("user_id");

-- AddForeignKey (only if referenced tables exist)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'flights') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'pending_flight_updates_flight_id_fkey'
        ) THEN
            ALTER TABLE "pending_flight_updates" ADD CONSTRAINT "pending_flight_updates_flight_id_fkey" 
            FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
    END IF;
    
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'pending_flight_updates_user_id_fkey'
        ) THEN
            ALTER TABLE "pending_flight_updates" ADD CONSTRAINT "pending_flight_updates_user_id_fkey" 
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
        
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'pending_update_statistics_user_id_fkey'
        ) THEN
            ALTER TABLE "pending_update_statistics" ADD CONSTRAINT "pending_update_statistics_user_id_fkey" 
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
    END IF;
END $$;

