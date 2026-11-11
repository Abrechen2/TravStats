-- Tours become a shareable entry type (tours-own-domain T1b): a notice may name one.
-- A tour shares the roadtrip's table and key column (`trip_routes.share_key`, told apart by
-- `kind`), so only the notice vocabulary widens. Mirrors schemas/sharing.ts; shareVocabulary.test.ts
-- holds the two together.
ALTER TABLE share_notices DROP CONSTRAINT share_notices_entity_type_check;
ALTER TABLE share_notices ADD CONSTRAINT share_notices_entity_type_check
  CHECK (entity_type IS NULL OR entity_type IN
    ('trip', 'flight', 'lodgingStay', 'cruise', 'rail', 'bus', 'ferry', 'rental', 'roadtrip', 'tour', 'stop'));
