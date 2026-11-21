-- CreateTable
CREATE TABLE "entry_photo_dirty" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "marked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entry_photo_dirty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entry_photo_dirty_user_id_kind_entry_id_key" ON "entry_photo_dirty"("user_id", "kind", "entry_id");

-- AddForeignKey
ALTER TABLE "entry_photo_dirty" ADD CONSTRAINT "entry_photo_dirty_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
