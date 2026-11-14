-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "public_url_check_ok" BOOLEAN,
ADD COLUMN     "public_url_checked_at" TIMESTAMP(3),
ADD COLUMN     "public_url_checked_url" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "readiness_ack_version" TEXT NOT NULL DEFAULT '2.7.0';

-- CreateTable
CREATE TABLE "readiness_item_states" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "readiness_item_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "readiness_note_acks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "readiness_note_acks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instance_version_history" (
    "version" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instance_version_history_pkey" PRIMARY KEY ("version")
);

-- CreateIndex
CREATE UNIQUE INDEX "readiness_item_states_user_id_item_id_key" ON "readiness_item_states"("user_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "readiness_note_acks_user_id_note_id_key" ON "readiness_note_acks"("user_id", "note_id");

-- AddForeignKey
ALTER TABLE "readiness_item_states" ADD CONSTRAINT "readiness_item_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "readiness_note_acks" ADD CONSTRAINT "readiness_note_acks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
