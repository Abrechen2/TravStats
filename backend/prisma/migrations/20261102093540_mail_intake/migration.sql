-- CreateTable
CREATE TABLE "mail_intake_sources" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "kind" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "tls_mode" TEXT NOT NULL DEFAULT 'tls',
    "username" TEXT NOT NULL,
    "password_encrypted" TEXT,
    "folder" TEXT NOT NULL DEFAULT 'INBOX',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_run_at" TIMESTAMP(3),
    "last_ok_at" TIMESTAMP(3),
    "last_error" TEXT,
    "last_error_at" TIMESTAMP(3),
    "uid_validity" TEXT,
    "last_uid" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_intake_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_intake_addresses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_intake_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_intake_senders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "allowed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_intake_senders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_intake_messages" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "user_id" TEXT,
    "message_id" TEXT NOT NULL,
    "uid" INTEGER NOT NULL,
    "received_at" TIMESTAMP(3),
    "from_address" TEXT,
    "subject" TEXT,
    "document_id" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "domain" TEXT,
    "summary" JSONB,
    "auth_result" TEXT,
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_intake_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mail_intake_sources_user_id_key" ON "mail_intake_sources"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_intake_sources_instance_key" ON "mail_intake_sources"("kind") WHERE (user_id IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "mail_intake_addresses_user_id_key" ON "mail_intake_addresses"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_intake_addresses_token_hash_key" ON "mail_intake_addresses"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "mail_intake_senders_user_id_address_key" ON "mail_intake_senders"("user_id", "address");

-- CreateIndex
CREATE INDEX "mail_intake_messages_user_id_status_idx" ON "mail_intake_messages"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mail_intake_messages_source_id_message_id_key" ON "mail_intake_messages"("source_id", "message_id");

-- AddForeignKey
ALTER TABLE "mail_intake_sources" ADD CONSTRAINT "mail_intake_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_intake_addresses" ADD CONSTRAINT "mail_intake_addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_intake_senders" ADD CONSTRAINT "mail_intake_senders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_intake_messages" ADD CONSTRAINT "mail_intake_messages_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "mail_intake_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_intake_messages" ADD CONSTRAINT "mail_intake_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_intake_messages" ADD CONSTRAINT "mail_intake_messages_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
