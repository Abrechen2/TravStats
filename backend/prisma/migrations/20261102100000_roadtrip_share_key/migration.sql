-- Roadtrips become a shareable entry type (forgejo#404): the key every member's copy carries.
-- AlterTable
ALTER TABLE "trip_routes" ADD COLUMN     "share_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "trip_routes_user_id_share_key_key" ON "trip_routes"("user_id", "share_key");

-- A notice may name a roadtrip.
ALTER TABLE share_notices DROP CONSTRAINT share_notices_entity_type_check;
ALTER TABLE share_notices ADD CONSTRAINT share_notices_entity_type_check
  CHECK (entity_type IS NULL OR entity_type IN
    ('trip', 'flight', 'lodgingStay', 'cruise', 'rail', 'bus', 'ferry', 'rental', 'roadtrip', 'stop'));
