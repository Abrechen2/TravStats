-- AlterTable
ALTER TABLE "users" ADD COLUMN     "two_factor_enabled_at" TIMESTAMP(3),
ADD COLUMN     "two_factor_pending_secret" TEXT,
ADD COLUMN     "two_factor_secret" TEXT,
ADD COLUMN     "two_factor_token" TEXT,
ADD COLUMN     "two_factor_token_expiry" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "two_factor_recovery_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "two_factor_recovery_codes_user_id_idx" ON "two_factor_recovery_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_two_factor_token_key" ON "users"("two_factor_token");

-- AddForeignKey
ALTER TABLE "two_factor_recovery_codes" ADD CONSTRAINT "two_factor_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

