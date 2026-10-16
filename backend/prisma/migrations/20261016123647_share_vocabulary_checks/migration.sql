-- Trip sharing vocabularies as CHECK constraints (spec 2026-10-16, D6).
-- Lists mirror backend/src/schemas/sharing.ts; shareVocabulary.test.ts holds
-- them together. Offending rows are counted first so a failure names them
-- instead of surfacing as a bare constraint violation at boot.
DO $$
DECLARE
  bad_status integer;
  bad_kind integer;
  bad_type integer;
BEGIN
  SELECT count(*) INTO bad_status FROM share_consents
    WHERE status NOT IN ('pending', 'accepted', 'declined', 'withdrawn');
  SELECT count(*) INTO bad_kind FROM share_notices
    WHERE kind NOT IN ('shared', 'created', 'updated', 'deleted', 'left');
  SELECT count(*) INTO bad_type FROM share_notices
    WHERE entity_type IS NOT NULL AND entity_type NOT IN
      ('trip', 'flight', 'lodgingStay', 'cruise', 'rail', 'bus', 'ferry', 'rental', 'stop');
  IF bad_status + bad_kind + bad_type > 0 THEN
    RAISE EXCEPTION 'share vocabulary: % consent status, % notice kind and % entity type values are outside the lists',
      bad_status, bad_kind, bad_type;
  END IF;
END $$;

ALTER TABLE share_consents ADD CONSTRAINT share_consents_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn'));
ALTER TABLE share_notices ADD CONSTRAINT share_notices_kind_check
  CHECK (kind IN ('shared', 'created', 'updated', 'deleted', 'left'));
ALTER TABLE share_notices ADD CONSTRAINT share_notices_entity_type_check
  CHECK (entity_type IS NULL OR entity_type IN
    ('trip', 'flight', 'lodgingStay', 'cruise', 'rail', 'bus', 'ferry', 'rental', 'stop'));
