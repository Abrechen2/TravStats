-- CreateTable
CREATE TABLE "travtrack_dawarich_imports" (
    "user_id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "run_id" TEXT,
    "from_day" DATE NOT NULL,
    "until_day" DATE NOT NULL,
    "next_day" DATE NOT NULL,
    "days_done" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB NOT NULL DEFAULT '{}',
    "last_error_kind" TEXT,
    "heartbeat_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "travtrack_dawarich_imports_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "travtrack_dawarich_imports_import_id_key" ON "travtrack_dawarich_imports"("import_id");

-- AddForeignKey
ALTER TABLE "travtrack_dawarich_imports" ADD CONSTRAINT "travtrack_dawarich_imports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_dawarich_imports" ADD CONSTRAINT "travtrack_dawarich_imports_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "travtrack_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The closed vocabulary and the range, held by the database (hand-appended; Prisma has no enum-less CHECK).
ALTER TABLE "travtrack_dawarich_imports" ADD CONSTRAINT "travtrack_dawarich_imports_status_check"
  CHECK ("status" IN ('running', 'paused', 'interrupted', 'complete', 'incomplete', 'failed', 'cancelled'));
ALTER TABLE "travtrack_dawarich_imports" ADD CONSTRAINT "travtrack_dawarich_imports_range_check"
  CHECK ("from_day" <= "until_day" AND "next_day" >= "from_day");
