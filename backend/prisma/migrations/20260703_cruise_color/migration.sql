-- Additive: user-selectable per-cruise map color (nullable). Hand-written
-- because the schema has pre-existing drift that blocks `prisma migrate dev`.
ALTER TABLE "cruises" ADD COLUMN "color" TEXT;
