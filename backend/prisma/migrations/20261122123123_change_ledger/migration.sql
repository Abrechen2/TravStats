-- CreateTable
CREATE TABLE "change_ledger_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "change_set_id" TEXT NOT NULL,
    "entity_type" VARCHAR(32) NOT NULL,
    "entity_id" VARCHAR(64) NOT NULL,
    "operation" VARCHAR(8) NOT NULL,
    "field" VARCHAR(64),
    "old_value" TEXT,
    "new_value" TEXT,
    "omitted" BOOLEAN NOT NULL DEFAULT false,
    "label" VARCHAR(160),
    "source" VARCHAR(16) NOT NULL,
    "actor_user_id" TEXT,
    "reason" VARCHAR(200),
    "restored_from_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "change_ledger_entries_user_id_entity_type_entity_id_created_idx" ON "change_ledger_entries"("user_id", "entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "change_ledger_entries_created_at_idx" ON "change_ledger_entries"("created_at");

-- AddForeignKey
ALTER TABLE "change_ledger_entries" ADD CONSTRAINT "change_ledger_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
