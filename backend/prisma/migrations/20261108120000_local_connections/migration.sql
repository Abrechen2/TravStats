-- Friends, one connection (spec 2026-11-08 §11.3): a friend on the SAME server is one row per
-- unordered pair. The table only; the data migration that fills it is the next file.

-- CreateTable
CREATE TABLE "local_connections" (
    "id" TEXT NOT NULL,
    "user_low_id" TEXT NOT NULL,
    "user_high_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "requested_by" TEXT NOT NULL,
    "low_switches" JSONB NOT NULL DEFAULT '{}',
    "high_switches" JSONB NOT NULL DEFAULT '{}',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "ended_by" TEXT,

    CONSTRAINT "local_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "local_connections_user_high_id_idx" ON "local_connections"("user_high_id");

-- CreateIndex
CREATE UNIQUE INDEX "local_connections_user_low_id_user_high_id_key" ON "local_connections"("user_low_id", "user_high_id");

-- AddForeignKey
ALTER TABLE "local_connections" ADD CONSTRAINT "local_connections_user_low_id_fkey" FOREIGN KEY ("user_low_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_connections" ADD CONSTRAINT "local_connections_user_high_id_fkey" FOREIGN KEY ("user_high_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One row per unordered pair: the low id sorts first in BYTE order (the order JavaScript's `<`
-- uses), whatever the database collation says. The asker is one of the two.
ALTER TABLE "local_connections" ADD CONSTRAINT "local_connections_order_check"
  CHECK ("user_low_id" COLLATE "C" < "user_high_id" COLLATE "C");
ALTER TABLE "local_connections" ADD CONSTRAINT "local_connections_state_check"
  CHECK ("state" IN ('pending', 'active', 'declined', 'revoked'));
ALTER TABLE "local_connections" ADD CONSTRAINT "local_connections_requested_by_check"
  CHECK ("requested_by" IN ("user_low_id", "user_high_id"));
