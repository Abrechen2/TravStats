-- Multi-domain foundation: add domain columns to UserSettings, Achievement, ParserTemplate.
-- Enables future cruise / shared achievement domains without a second migration.

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN "enabled_domains" TEXT[] DEFAULT ARRAY['flight']::TEXT[];

-- AlterTable
ALTER TABLE "achievements" ADD COLUMN "domain" TEXT NOT NULL DEFAULT 'flight';

-- AlterTable
ALTER TABLE "parser_templates" ADD COLUMN "domain" TEXT NOT NULL DEFAULT 'flight';

-- CreateIndex
CREATE INDEX "achievements_domain_idx" ON "achievements"("domain");

-- CreateIndex
CREATE INDEX "parser_templates_domain_idx" ON "parser_templates"("domain");
