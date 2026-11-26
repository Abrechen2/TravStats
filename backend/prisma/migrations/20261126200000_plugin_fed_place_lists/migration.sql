-- AlterTable
ALTER TABLE "place_list_entries" ADD COLUMN     "external_fields" JSONB;

-- AlterTable
ALTER TABLE "place_lists" ADD COLUMN     "plugin_columns" JSONB,
ADD COLUMN     "plugin_id" TEXT;

-- AlterTable
ALTER TABLE "suggestion_plugins" ADD COLUMN     "list_enabled" BOOLEAN;

-- CreateIndex
CREATE UNIQUE INDEX "place_lists_plugin_id_key" ON "place_lists"("plugin_id");

-- AddForeignKey
ALTER TABLE "place_lists" ADD CONSTRAINT "place_lists_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "suggestion_plugins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

