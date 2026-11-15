-- CreateTable
CREATE TABLE "revoked_sessions" (
    "jti" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revoked_sessions_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "revoked_sessions_expires_at_idx" ON "revoked_sessions"("expires_at");

