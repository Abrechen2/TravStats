-- CreateTable
CREATE TABLE "travtrack_day_sources" (
    "user_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "zone" TEXT NOT NULL,
    "from_at" TIMESTAMP(3) NOT NULL,
    "until_at" TIMESTAMP(3) NOT NULL,
    "segments" JSONB NOT NULL,
    "scores" JSONB NOT NULL,
    "outlier_ids" JSONB NOT NULL,
    "outlier_count" INTEGER NOT NULL DEFAULT 0,
    "breaks" JSONB NOT NULL,
    "bridges" JSONB NOT NULL,
    "mixed" BOOLEAN NOT NULL DEFAULT false,
    "best_score" DOUBLE PRECISION NOT NULL,
    "clock_offset" JSONB,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "override_source" TEXT,
    "outlier_decision" TEXT,
    "derived_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travtrack_day_sources_pkey" PRIMARY KEY ("user_id","day")
);

-- CreateIndex
CREATE INDEX "travtrack_day_sources_user_id_from_at_idx" ON "travtrack_day_sources"("user_id", "from_at");

-- AddForeignKey
ALTER TABLE "travtrack_day_sources" ADD CONSTRAINT "travtrack_day_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
