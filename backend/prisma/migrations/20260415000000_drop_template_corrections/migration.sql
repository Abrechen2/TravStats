-- Drop unused TemplateCorrection table.
-- The model was defined in the schema but never written to or read from
-- anywhere in the codebase. Pattern-feedback infrastructure has moved to
-- parser_feedback / analytics_events. Any accumulated rows are discarded
-- intentionally (no user-facing data lives here).

DROP TABLE IF EXISTS "template_corrections" CASCADE;
