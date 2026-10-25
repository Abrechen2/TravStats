-- CreateTable
CREATE TABLE "travtrack_deleted_points" (
    "user_id" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "t_s" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travtrack_deleted_points_pkey" PRIMARY KEY ("user_id","digest")
);

-- CreateIndex
CREATE INDEX "travtrack_deleted_points_user_id_t_s_idx" ON "travtrack_deleted_points"("user_id", "t_s");

-- AddForeignKey
ALTER TABLE "travtrack_deleted_points" ADD CONSTRAINT "travtrack_deleted_points_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
