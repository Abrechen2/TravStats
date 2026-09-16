-- Recording segments and raw cumulative distance for imported tracks.
--
-- Both nullable: every existing row was written without them and keeps working.
-- A null `segment_starts` reads as one continuous segment (which is what the
-- old flattening assumed), and a null `cumulative_km` makes an adoption fall
-- back to measuring the simplified line, exactly as it did before.
ALTER TABLE "trip_route_tracks" ADD COLUMN "segment_starts" JSONB;
ALTER TABLE "trip_route_tracks" ADD COLUMN "cumulative_km" JSONB;
