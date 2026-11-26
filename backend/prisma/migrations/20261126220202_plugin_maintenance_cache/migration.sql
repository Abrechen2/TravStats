-- CreateTable
CREATE TABLE "plugin_maintenance_caches" (
    "plugin_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'de',
    "data" JSONB,
    "stops_sent" INTEGER NOT NULL DEFAULT 0,
    "stops_withheld" TEXT,
    "refreshed_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "failure" TEXT,
    "failed_at" TIMESTAMP(3),

    CONSTRAINT "plugin_maintenance_caches_pkey" PRIMARY KEY ("plugin_id")
);

-- CreateIndex
CREATE INDEX "plugin_maintenance_caches_user_id_idx" ON "plugin_maintenance_caches"("user_id");

-- CreateIndex
CREATE INDEX "plugin_maintenance_caches_due_at_idx" ON "plugin_maintenance_caches"("due_at");

-- AddForeignKey
ALTER TABLE "plugin_maintenance_caches" ADD CONSTRAINT "plugin_maintenance_caches_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "suggestion_plugins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_maintenance_caches" ADD CONSTRAINT "plugin_maintenance_caches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
