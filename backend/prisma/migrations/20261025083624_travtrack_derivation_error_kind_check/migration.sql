-- Generated empty by `prisma migrate dev --create-only` (Prisma has no
-- enum-less CHECK); hand-written below, as the CHECKs of
-- `20261025074104_location_evidence` are.
--
-- `last_error_kind` is a closed vocabulary, never a message (TravTrack plan
-- E1/E6): the country projection's failure kinds, or null. Nothing writes the
-- column yet, so no existing row can violate it.
ALTER TABLE "travtrack_derivation_state" ADD CONSTRAINT "travtrack_derivation_state_last_error_kind_check"
  CHECK ("last_error_kind" IS NULL OR "last_error_kind" IN ('disabled', 'database', 'reducer'));
