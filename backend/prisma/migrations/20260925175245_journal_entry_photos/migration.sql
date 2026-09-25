-- CreateTable
CREATE TABLE "journal_entry_photos" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "trip_photo_id" TEXT NOT NULL,
    "sort_idx" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "journal_entry_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "journal_entry_photos_trip_photo_id_idx" ON "journal_entry_photos"("trip_photo_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entry_photos_entry_id_trip_photo_id_key" ON "journal_entry_photos"("entry_id", "trip_photo_id");

-- AddForeignKey
ALTER TABLE "journal_entry_photos" ADD CONSTRAINT "journal_entry_photos_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "trip_journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_photos" ADD CONSTRAINT "journal_entry_photos_trip_photo_id_fkey" FOREIGN KEY ("trip_photo_id") REFERENCES "trip_photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
