-- CreateTable
CREATE TABLE "reroute_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "route_id" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cursor" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "routed" INTEGER NOT NULL DEFAULT 0,
    "kept" INTEGER NOT NULL DEFAULT 0,
    "failure_counts" JSONB NOT NULL DEFAULT '{}',
    "failure_sample" JSONB NOT NULL DEFAULT '[]',
    "stop_reason" TEXT,
    "resume_after" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "reroute_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reroute_runs_status_resume_after_idx" ON "reroute_runs"("status", "resume_after");

-- CreateIndex
CREATE INDEX "reroute_runs_scope_user_id_created_at_idx" ON "reroute_runs"("scope", "user_id", "created_at");
