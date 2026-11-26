-- CreateTable
CREATE TABLE "travtrack_year_summaries" (
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travtrack_year_summaries_pkey" PRIMARY KEY ("user_id","year")
);

-- AddForeignKey
ALTER TABLE "travtrack_year_summaries" ADD CONSTRAINT "travtrack_year_summaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
