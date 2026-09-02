-- CreateTable
CREATE TABLE "data_quality_flags" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "data_quality_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_quality_flags_user_id_status_idx" ON "data_quality_flags"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "data_quality_flags_user_id_entity_type_entity_id_kind_key" ON "data_quality_flags"("user_id", "entity_type", "entity_id", "kind");

-- AddForeignKey
ALTER TABLE "data_quality_flags" ADD CONSTRAINT "data_quality_flags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

