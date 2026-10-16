-- CreateTable
CREATE TABLE "comparison_circles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "members" JSONB NOT NULL,

    CONSTRAINT "comparison_circles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comparison_circles_user_id_idx" ON "comparison_circles"("user_id");

-- AddForeignKey
ALTER TABLE "comparison_circles" ADD CONSTRAINT "comparison_circles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
