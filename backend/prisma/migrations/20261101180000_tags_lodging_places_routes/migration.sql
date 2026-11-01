-- Tags for lodging houses, places and roadtrips/tours (forgejo#405), like the
-- other domains' `tags text[]`. Additive; existing rows read as no tags.
ALTER TABLE "lodgings" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "places" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "trip_routes" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
