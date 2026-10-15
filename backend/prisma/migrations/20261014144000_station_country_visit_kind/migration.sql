ALTER TABLE "trip_stops" ADD COLUMN "country_visit_kind" TEXT NOT NULL DEFAULT 'visit';
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_country_visit_kind_check" CHECK ("country_visit_kind" IN ('visit', 'transit'));
