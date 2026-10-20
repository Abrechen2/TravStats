-- CreateTable
CREATE TABLE "calendar_feeds" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_feeds_user_id_key" ON "calendar_feeds"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_feeds_token_hash_key" ON "calendar_feeds"("token_hash");

-- AddForeignKey
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
