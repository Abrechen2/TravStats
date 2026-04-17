-- Drop dead developer-mode settings columns.
-- Left over from the parser training flow that got replaced by
-- hasParserAccess = user.isAdmin in the frontend. The columns were
-- still written to but no longer read for gating anything.

ALTER TABLE "user_settings"
  DROP COLUMN IF EXISTS "developer_mode_enabled",
  DROP COLUMN IF EXISTS "developer_mode_confirmed_at";
