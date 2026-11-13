-- CreateTable
CREATE TABLE "travtrack_stop_dismissals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "from_ms" BIGINT NOT NULL,
    "until_ms" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travtrack_stop_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "travtrack_stop_dismissals_user_id_from_ms_until_ms_key" ON "travtrack_stop_dismissals"("user_id", "from_ms", "until_ms");

-- AddForeignKey
ALTER TABLE "travtrack_stop_dismissals" ADD CONSTRAINT "travtrack_stop_dismissals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
