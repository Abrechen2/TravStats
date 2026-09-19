-- Which KIND of document a training sample is, so the workshop can derive a
-- template for it (forgejo#124 phase 6). `type` beside it is the MEDIUM — a
-- mail or a boarding pass — and never answered this.
--
-- `flight` for every existing row because that is the only value they could
-- have had: the deriver wrote flight patterns and nothing else, and
-- `parser_templates.domain` has carried the same default since it was created.
-- AlterTable
ALTER TABLE "training_data" ADD COLUMN     "domain" TEXT NOT NULL DEFAULT 'flight';
