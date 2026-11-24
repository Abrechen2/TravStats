-- CreateTable
CREATE TABLE "calendar_rules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "source_id" TEXT,
    "token" TEXT,
    "match_mode" TEXT NOT NULL DEFAULT 'contains',
    "purpose" TEXT,
    "name_template" TEXT,
    "place_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_rules_user_id_position_idx" ON "calendar_rules"("user_id", "position");

-- AddForeignKey
ALTER TABLE "calendar_rules" ADD CONSTRAINT "calendar_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_rules" ADD CONSTRAINT "calendar_rules_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "calendar_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_rules" ADD CONSTRAINT "calendar_rules_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE;
