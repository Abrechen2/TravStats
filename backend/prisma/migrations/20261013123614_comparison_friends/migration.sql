-- CreateTable
CREATE TABLE "comparison_peers" (
    "origin" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "comparison_peers_pkey" PRIMARY KEY ("origin")
);

-- CreateTable
CREATE TABLE "comparison_invites" (
    "hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "comparison_invites_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "comparison_links" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "remote_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comparison_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparison_grants" (
    "id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT '',
    "scope" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comparison_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparison_groups" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channels" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "comparison_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparison_audit" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comparison_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparison_nonces" (
    "id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comparison_nonces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comparison_invites_user_id_idx" ON "comparison_invites"("user_id");

-- CreateIndex
CREATE INDEX "comparison_links_channel_origin_idx" ON "comparison_links"("channel", "origin");

-- CreateIndex
CREATE UNIQUE INDEX "comparison_links_user_id_channel_key" ON "comparison_links"("user_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "comparison_grants_link_id_audience_key" ON "comparison_grants"("link_id", "audience");

-- CreateIndex
CREATE INDEX "comparison_groups_user_id_idx" ON "comparison_groups"("user_id");

-- CreateIndex
CREATE INDEX "comparison_audit_owner_id_created_at_idx" ON "comparison_audit"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "comparison_nonces_expires_at_idx" ON "comparison_nonces"("expires_at");

-- AddForeignKey
ALTER TABLE "comparison_invites" ADD CONSTRAINT "comparison_invites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparison_links" ADD CONSTRAINT "comparison_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparison_grants" ADD CONSTRAINT "comparison_grants_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "comparison_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparison_groups" ADD CONSTRAINT "comparison_groups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
