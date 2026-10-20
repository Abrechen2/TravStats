-- CreateTable
CREATE TABLE "country_overrides" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "day" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "country_overrides_user_id_country_code_key" ON "country_overrides"("user_id", "country_code");

-- AddForeignKey
ALTER TABLE "country_overrides" ADD CONSTRAINT "country_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
