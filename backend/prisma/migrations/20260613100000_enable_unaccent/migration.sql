-- Enable the `unaccent` extension so port search can fold diacritics.
-- Users type ASCII ("Malaga", "Warnemunde", "Tromso") while the catalog
-- stores accented names ("Málaga", "Warnemünde", "Tromsø"); the /ports
-- search runs both column and needle through unaccent() to match across the
-- fold. Idempotent and safe to re-run on prod (the postgis image ships the
-- contrib extension). Hand-written (not `prisma migrate dev`-generated) to
-- avoid bundling the pre-existing schema drift — see CLAUDE.md cruise-migration
-- note.
CREATE EXTENSION IF NOT EXISTS unaccent;
