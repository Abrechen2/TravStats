-- CreateTable
CREATE TABLE "document_link_suggestions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "entry_type" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "content_key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_link_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_link_passes" (
    "user_id" TEXT NOT NULL,
    "scanned_until" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_link_passes_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "document_link_suggestions_user_id_status_idx" ON "document_link_suggestions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "document_link_suggestions_document_id_content_key_key" ON "document_link_suggestions"("document_id", "content_key");

-- AddForeignKey
ALTER TABLE "document_link_suggestions" ADD CONSTRAINT "document_link_suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_link_suggestions" ADD CONSTRAINT "document_link_suggestions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_link_passes" ADD CONSTRAINT "document_link_passes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
