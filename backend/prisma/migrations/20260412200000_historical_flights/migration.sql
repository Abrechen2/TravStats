-- Allow NULL departure/arrival times for historical (route-only) flights
ALTER TABLE "flights" ALTER COLUMN "departure_time" DROP NOT NULL;
ALTER TABLE "flights" ALTER COLUMN "arrival_time" DROP NOT NULL;
