-- CreateTable
CREATE TABLE "lodging_photos" (
    "id" TEXT NOT NULL,
    "lodging_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "caption" TEXT,
    "sort_idx" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lodging_photos_lodging_id_idx" ON "lodging_photos"("lodging_id");

-- AddForeignKey
ALTER TABLE "lodging_photos" ADD CONSTRAINT "lodging_photos_lodging_id_fkey" FOREIGN KEY ("lodging_id") REFERENCES "lodgings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
