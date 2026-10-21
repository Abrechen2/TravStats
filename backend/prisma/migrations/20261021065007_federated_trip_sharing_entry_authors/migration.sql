-- CreateTable
CREATE TABLE "trip_share_entry_authors" (
    "group_id" TEXT NOT NULL,
    "entry_key" TEXT NOT NULL,
    "author_ref" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_share_entry_authors_pkey" PRIMARY KEY ("group_id","entry_key")
);

-- AddForeignKey
ALTER TABLE "trip_share_entry_authors" ADD CONSTRAINT "trip_share_entry_authors_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "trip_share_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
