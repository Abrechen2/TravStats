-- CreateTable
CREATE TABLE "travel_plan_guest_invites" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_plan_guest_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_plan_guest_joins" (
    "id" TEXT NOT NULL,
    "invite_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "browser_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_plan_guest_joins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_plan_guest_sessions" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "peer_fingerprint" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_plan_guest_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_plan_documents" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "uploaded_by_member_id" TEXT NOT NULL,
    "booking_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_plan_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "travel_plan_guest_invites_member_id_idx" ON "travel_plan_guest_invites"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "travel_plan_guest_joins_nonce_key" ON "travel_plan_guest_joins"("nonce");

-- CreateIndex
CREATE INDEX "travel_plan_guest_joins_expires_at_idx" ON "travel_plan_guest_joins"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "travel_plan_guest_sessions_token_hash_key" ON "travel_plan_guest_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "travel_plan_guest_sessions_member_id_idx" ON "travel_plan_guest_sessions"("member_id");

-- CreateIndex
CREATE INDEX "travel_plan_guest_sessions_expires_at_idx" ON "travel_plan_guest_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "travel_plan_documents_document_id_key" ON "travel_plan_documents"("document_id");

-- CreateIndex
CREATE INDEX "travel_plan_documents_plan_id_uploaded_by_member_id_idx" ON "travel_plan_documents"("plan_id", "uploaded_by_member_id");

-- AddForeignKey
ALTER TABLE "travel_plan_guest_invites" ADD CONSTRAINT "travel_plan_guest_invites_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "travel_plan_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_plan_guest_joins" ADD CONSTRAINT "travel_plan_guest_joins_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "travel_plan_guest_invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_plan_guest_joins" ADD CONSTRAINT "travel_plan_guest_joins_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "travel_plan_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_plan_guest_sessions" ADD CONSTRAINT "travel_plan_guest_sessions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "travel_plan_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_plan_documents" ADD CONSTRAINT "travel_plan_documents_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "travel_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_plan_documents" ADD CONSTRAINT "travel_plan_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_plan_documents" ADD CONSTRAINT "travel_plan_documents_uploaded_by_member_id_fkey" FOREIGN KEY ("uploaded_by_member_id") REFERENCES "travel_plan_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The closed vocabulary of a credential's kind (same practice as travel_plan_members).
ALTER TABLE "travel_plan_guest_sessions" ADD CONSTRAINT "travel_plan_guest_sessions_kind_check" CHECK ("kind" IN ('session', 'pat'));
