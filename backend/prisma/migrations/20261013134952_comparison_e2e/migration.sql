-- CreateTable
CREATE TABLE "comparison_devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "encryption" TEXT NOT NULL,
    "signing" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comparison_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparison_publications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "sender" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "manifest" JSONB,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comparison_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparison_chunks" (
    "publication_id" TEXT NOT NULL,
    "part" INTEGER NOT NULL,
    "bytes" TEXT NOT NULL,
    "digest" TEXT NOT NULL,

    CONSTRAINT "comparison_chunks_pkey" PRIMARY KEY ("publication_id","part")
);

-- CreateIndex
CREATE UNIQUE INDEX "comparison_devices_fingerprint_key" ON "comparison_devices"("fingerprint");

-- CreateIndex
CREATE INDEX "comparison_devices_user_id_idx" ON "comparison_devices"("user_id");

-- CreateIndex
CREATE INDEX "comparison_publications_user_id_audience_ready_idx" ON "comparison_publications"("user_id", "audience", "ready");

-- CreateIndex
CREATE INDEX "comparison_publications_link_id_idx" ON "comparison_publications"("link_id");

-- AddForeignKey
ALTER TABLE "comparison_devices" ADD CONSTRAINT "comparison_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparison_publications" ADD CONSTRAINT "comparison_publications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparison_chunks" ADD CONSTRAINT "comparison_chunks_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "comparison_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
