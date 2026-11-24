-- CreateTable
CREATE TABLE "suggestion_plugins" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "precision" TEXT NOT NULL DEFAULT '100m',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "backfill_allowed" BOOLEAN NOT NULL DEFAULT false,
    "last_version" INTEGER,
    "last_outcome" TEXT,
    "last_called_at" TIMESTAMP(3),
    "last_error_at" TIMESTAMP(3),
    "retry_at" TIMESTAMP(3),
    "failures" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suggestion_plugins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suggestion_plugin_calls" (
    "id" TEXT NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT NOT NULL,
    "stop_start_at" TIMESTAMP(3),
    "stop_end_at" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "suggestions" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "suggestion_plugin_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suggestion_plugins_user_id_idx" ON "suggestion_plugins"("user_id");

-- CreateIndex
CREATE INDEX "suggestion_plugin_calls_plugin_id_at_idx" ON "suggestion_plugin_calls"("plugin_id", "at");

-- CreateIndex
CREATE INDEX "suggestion_plugin_calls_plugin_id_stop_start_at_idx" ON "suggestion_plugin_calls"("plugin_id", "stop_start_at");

-- AddForeignKey
ALTER TABLE "suggestion_plugins" ADD CONSTRAINT "suggestion_plugins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestion_plugin_calls" ADD CONSTRAINT "suggestion_plugin_calls_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "suggestion_plugins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
