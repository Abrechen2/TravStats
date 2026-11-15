-- AlterTable
ALTER TABLE "users" ADD COLUMN     "two_factor_attempts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "login_throttles" (
    "username_key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "last_failure_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMP(3),

    CONSTRAINT "login_throttles_pkey" PRIMARY KEY ("username_key")
);
