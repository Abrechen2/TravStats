-- AlterTable
ALTER TABLE "trip_suggestion_decisions" ADD COLUMN     "end_day" DATE,
ADD COLUMN     "expanded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "home_signature" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'engine',
ADD COLUMN     "start_day" DATE;

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "trip_suggestion_quiet_days" INTEGER NOT NULL DEFAULT 14;

-- One decision table (trip suggestions v2): every answered TravTrack trip
-- question becomes a decision with its day span, so engine A and the TravTrack
-- sweep share one rejection memory. The location_suggestions rows stay.
INSERT INTO "trip_suggestion_decisions"
  ("id", "user_id", "kind", "fingerprint", "status", "target_id", "member_keys",
   "member_content_keys", "start_day", "end_day", "source", "created_at", "updated_at")
SELECT gen_random_uuid()::text,
       ls."user_id",
       CASE WHEN ls."evidence"->>'tripId' IS NOT NULL THEN 'extend' ELSE 'new_trip' END,
       'travtrack:' || ls."evidence_key",
       CASE ls."status" WHEN 'rejected' THEN 'dismissed' ELSE 'accepted' END,
       ls."evidence"->>'tripId',
       ARRAY[]::text[],
       ARRAY[]::text[],
       (ls."evidence"->>'fromDay')::date,
       (ls."evidence"->>'toDay')::date,
       'travtrack',
       COALESCE(ls."resolved_at", ls."detected_at"),
       COALESCE(ls."resolved_at", ls."detected_at")
  FROM "location_suggestions" ls
 WHERE ls."kind" = 'trip'
   AND ls."status" IN ('rejected', 'accepted')
   AND ls."evidence"->>'fromDay' ~ '^\d{4}-\d{2}-\d{2}$'
   AND ls."evidence"->>'toDay' ~ '^\d{4}-\d{2}-\d{2}$'
ON CONFLICT ("user_id", "fingerprint") DO NOTHING;
