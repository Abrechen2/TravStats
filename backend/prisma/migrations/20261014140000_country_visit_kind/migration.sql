ALTER TABLE "places" ADD COLUMN "country_visit_kind" TEXT NOT NULL DEFAULT 'visit';
ALTER TABLE "lodgings" ADD COLUMN "country_visit_kind" TEXT NOT NULL DEFAULT 'visit';
ALTER TABLE "places" ADD CONSTRAINT "places_country_visit_kind_check" CHECK ("country_visit_kind" IN ('visit', 'transit'));
ALTER TABLE "lodgings" ADD CONSTRAINT "lodgings_country_visit_kind_check" CHECK ("country_visit_kind" IN ('visit', 'transit'));
