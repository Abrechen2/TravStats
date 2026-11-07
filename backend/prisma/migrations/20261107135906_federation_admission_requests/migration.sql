-- CreateTable
CREATE TABLE "federation_admission_requests" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "local_user_id" TEXT NOT NULL,
    "invite_ref" TEXT NOT NULL,
    "invite_hash" TEXT,
    "scope" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failure_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by" TEXT,

    CONSTRAINT "federation_admission_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "federation_admission_requests_invite_hash_key" ON "federation_admission_requests"("invite_hash");

-- CreateIndex
CREATE INDEX "federation_admission_requests_status_direction_idx" ON "federation_admission_requests"("status", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "federation_admission_requests_direction_origin_local_user_i_key" ON "federation_admission_requests"("direction", "origin", "local_user_id");

-- AddForeignKey
ALTER TABLE "federation_admission_requests" ADD CONSTRAINT "federation_admission_requests_local_user_id_fkey" FOREIGN KEY ("local_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
