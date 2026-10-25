-- AlterTable
ALTER TABLE "travtrack_share_past_spans" ADD COLUMN     "profile_zone" TEXT;

-- ---------------------------------------------------------------------------
-- Hand-written below this line (TravTrack plan T7, Codex review of the share
-- restrictions, third round). `prisma migrate dev --create-only` generated the
-- column above; the backfill and the triggers are appended by hand, as in
-- `20261025052500_travtrack_share_restrictions`. `check:drift` cannot see
-- triggers, so `routes/__tests__/travtrack.shareRestrictionsRecorded.test.ts`
-- drives them through writes that bypass every route.
--
-- A trip span without a zone of its own is read on the owner's profile clock
-- (`user_settings.data.display.timezone`, UTC when unset). Reading a recorded
-- span in TODAY's profile zone let a zone change and back expose hours the
-- first change hid. So each recorded span carries the profile zone in force
-- when it was recorded, and a profile-zone change — an update, the settings
-- row deleted, or one created where none was — records every shared trip's
-- current span in the zone it leaves.
-- ---------------------------------------------------------------------------

-- Spans recorded before this migration: the profile zone in force now is the
-- best reading there is (it is what they were read in until now).
UPDATE "travtrack_share_past_spans" ps
SET "profile_zone" = us."data" #>> '{display,timezone}'
FROM "travtrack_share_snapshots" s
JOIN "user_settings" us ON us."user_id" = s."user_id"
WHERE ps."snapshot_id" = s."id";

CREATE OR REPLACE FUNCTION travtrack_share_capture_trip_span()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO "travtrack_share_past_spans"
    ("id", "snapshot_id", "start_date", "end_date", "start_day", "end_day", "start_zone",
     "end_zone", "profile_zone")
  SELECT gen_random_uuid()::text, s."id", OLD."start_date", OLD."end_date", OLD."start_day",
         OLD."end_day", OLD."start_zone", OLD."end_zone",
         (SELECT us."data" #>> '{display,timezone}' FROM "user_settings" us
          WHERE us."user_id" = OLD."user_id")
  FROM "travtrack_share_snapshots" s
  WHERE s."trip_id" = OLD."id" AND s."user_id" = OLD."user_id";
  RETURN NULL;
END $fn$;

-- The profile zone a shared trip's days were read in, whenever it changes.
-- Only trips missing a zone of their own read the profile clock at all.
CREATE OR REPLACE FUNCTION travtrack_share_capture_profile_zone()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  owner_id TEXT;
  left_zone TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- No row before: the default (UTC) was in force.
    owner_id := NEW."user_id";
    left_zone := NULL;
  ELSE
    owner_id := OLD."user_id";
    left_zone := OLD."data" #>> '{display,timezone}';
    IF TG_OP = 'UPDATE'
       AND NEW."user_id" IS NOT DISTINCT FROM OLD."user_id"
       AND (NEW."data" #>> '{display,timezone}') IS NOT DISTINCT FROM left_zone THEN
      RETURN NULL;
    END IF;
  END IF;
  INSERT INTO "travtrack_share_past_spans"
    ("id", "snapshot_id", "start_date", "end_date", "start_day", "end_day", "start_zone",
     "end_zone", "profile_zone")
  SELECT gen_random_uuid()::text, s."id", t."start_date", t."end_date", t."start_day",
         t."end_day", t."start_zone", t."end_zone", left_zone
  FROM "travtrack_share_snapshots" s
  JOIN "trips" t ON t."id" = s."trip_id"
  WHERE s."user_id" = owner_id AND (t."start_zone" IS NULL OR t."end_zone" IS NULL);
  RETURN NULL;
END $fn$;

CREATE TRIGGER "travtrack_share_profile_zone"
AFTER INSERT OR UPDATE OF "data", "user_id" OR DELETE ON "user_settings"
FOR EACH ROW
EXECUTE FUNCTION travtrack_share_capture_profile_zone();
