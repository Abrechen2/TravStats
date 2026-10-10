-- AlterTable
ALTER TABLE "device_push" ADD COLUMN     "muted_trip_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "client_write_refs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_ref" VARCHAR(64) NOT NULL,
    "kind" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_write_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_write_refs_created_at_idx" ON "client_write_refs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "client_write_refs_user_id_client_ref_key" ON "client_write_refs"("user_id", "client_ref");

-- AddForeignKey
ALTER TABLE "client_write_refs" ADD CONSTRAINT "client_write_refs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
