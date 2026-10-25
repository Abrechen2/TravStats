-- TravTrack plan L4: a third kind of location question, the trip TravTrack
-- saw. Only the closed vocabulary changes; Prisma has no enum-less CHECK, so
-- this migration is hand-written (it holds no schema change `check:drift`
-- could see). Every existing row is a country or a journey and stays valid.
ALTER TABLE "location_suggestions" DROP CONSTRAINT "location_suggestions_kind_check";

ALTER TABLE "location_suggestions" ADD CONSTRAINT "location_suggestions_kind_check"
  CHECK ("kind" IN ('country', 'journey', 'trip'));
