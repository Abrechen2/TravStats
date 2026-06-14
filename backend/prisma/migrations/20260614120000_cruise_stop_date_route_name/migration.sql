-- Cruise itinerary dates (#132) + cruise route/itinerary name (#133)
--
-- Hand-written (not `prisma migrate dev`-generated) on purpose: the existing
-- schema has pre-existing drift vs. the migration history (see CLAUDE.md),
-- which `prisma migrate dev` would bundle into any new migration and break
-- prod on deploy. Both additions are nullable column adds — safe + additive.

-- #133: official itinerary / route name as printed on booking confirmations
-- (e.g. "Kanaren mit Marokko"), distinct from the parent trip's user label.
ALTER TABLE "cruises" ADD COLUMN "route_name" TEXT;

-- #132: per-stop calendar date. Booking confirmations list a date per stop
-- (often without clock times), which previously had nowhere to live — only
-- arrival_time / departure_time existed, so date-only stops dropped the date.
ALTER TABLE "cruise_stops" ADD COLUMN "date" TIMESTAMP(3);
