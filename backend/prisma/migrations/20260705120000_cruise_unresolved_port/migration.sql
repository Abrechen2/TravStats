-- Unresolved cruise port as a first-class third stop state (v2.3).
--
-- Hand-written (not `prisma migrate dev`-generated) on purpose: the existing
-- schema has pre-existing drift vs. the migration history (see CLAUDE.md),
-- which `prisma migrate dev` would bundle into any new migration and break
-- prod on deploy. Nullable column add — safe + additive.

ALTER TABLE "cruise_stops" ADD COLUMN "unresolved_port_name" TEXT;

-- One-time backfill: recover ports that earlier imports downgraded to sea days
-- with the name stuffed into excursion_note as "[unmatched: X]". Turn them back
-- into unresolved ports and strip the tag from the note. Idempotent: the LIKE
-- guard finds nothing on a re-run after cleanup.
UPDATE "cruise_stops"
SET unresolved_port_name = substring(excursion_note from '\[unmatched: (.+?)\]'),
    is_at_sea = false,
    excursion_note = NULLIF(trim(regexp_replace(excursion_note, '\s*\[unmatched: .+?\]', '')), '')
WHERE is_at_sea = true AND excursion_note LIKE '%[unmatched:%';
