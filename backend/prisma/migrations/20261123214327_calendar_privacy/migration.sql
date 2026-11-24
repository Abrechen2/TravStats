-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "calendar_geocode_locations" BOOLEAN NOT NULL DEFAULT false;

-- A matched calendar event is personal text (title, location). Once a finding
-- leaves the open states, whatever path moved it (accept, reject, supersede,
-- covered, invalidate, an undo, a future writer), only the event's source, keyed
-- UID and span may remain; a finding the calendar alone made also loses the name
-- it took from the title unless it was accepted (then the name is the visit's).
-- A trigger, so no write path can forget it (security review, 2026-11-23).
CREATE OR REPLACE FUNCTION dawarich_stays_shrink_calendar() RETURNS trigger AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'accepting')
     AND NEW.evidence IS NOT NULL
     AND jsonb_typeof(NEW.evidence -> 'calendar') = 'object'
     AND (NEW.evidence -> 'calendar') - ARRAY['sourceId', 'uidHash', 'start', 'end'] <> '{}'::jsonb
  THEN
    IF NEW.evidence ->> 'createdFrom' = 'calendar' AND NEW.status <> 'accepted' THEN
      NEW.name := NULL;
    END IF;
    NEW.evidence := jsonb_set(
      NEW.evidence - (CASE WHEN NEW.evidence ->> 'suggestedPurposeFrom' = 'calendar'
                           THEN ARRAY['suggestedPurpose', 'suggestedPurposeFrom']
                           ELSE ARRAY[]::text[] END),
      '{calendar}',
      jsonb_strip_nulls(jsonb_build_object(
        'sourceId', NEW.evidence -> 'calendar' -> 'sourceId',
        'uidHash', NEW.evidence -> 'calendar' -> 'uidHash',
        'start', NEW.evidence -> 'calendar' -> 'start',
        'end', NEW.evidence -> 'calendar' -> 'end')));
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER dawarich_stays_shrink_calendar
  BEFORE INSERT OR UPDATE ON dawarich_stays
  FOR EACH ROW EXECUTE FUNCTION dawarich_stays_shrink_calendar();
