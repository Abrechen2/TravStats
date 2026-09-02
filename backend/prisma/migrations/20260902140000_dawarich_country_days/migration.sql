-- CreateTable
CREATE TABLE "country_days" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "country_code" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "point_count" INTEGER NOT NULL,
    "span_km" DOUBLE PRECISION NOT NULL,
    "partial_window" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dawarich_sweep_state" (
    "user_id" TEXT NOT NULL,
    "backfilled_from_month" TIMESTAMP(3),
    "backfill_complete" BOOLEAN NOT NULL DEFAULT false,
    "swept_through_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_error_kind" TEXT,
    "last_truncated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dawarich_sweep_state_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "country_days_user_id_country_code_idx" ON "country_days"("user_id", "country_code");

-- CreateIndex
CREATE UNIQUE INDEX "country_days_user_id_date_country_code_source_key" ON "country_days"("user_id", "date", "country_code", "source");

-- AddForeignKey
ALTER TABLE "country_days" ADD CONSTRAINT "country_days_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dawarich_sweep_state" ADD CONSTRAINT "dawarich_sweep_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

