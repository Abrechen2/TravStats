-- CreateTable
CREATE TABLE "cruise_leg_routes" (
    "id" TEXT NOT NULL,
    "cruise_id" TEXT NOT NULL,
    "from_kind" TEXT NOT NULL,
    "from_ref" TEXT NOT NULL,
    "to_kind" TEXT NOT NULL,
    "to_ref" TEXT NOT NULL,
    "waypoints" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cruise_leg_routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cruise_leg_routes_cruise_id_idx" ON "cruise_leg_routes"("cruise_id");

-- CreateIndex
CREATE UNIQUE INDEX "cruise_leg_routes_cruise_id_from_kind_from_ref_to_kind_to_r_key" ON "cruise_leg_routes"("cruise_id", "from_kind", "from_ref", "to_kind", "to_ref");

-- AddForeignKey
ALTER TABLE "cruise_leg_routes" ADD CONSTRAINT "cruise_leg_routes_cruise_id_fkey" FOREIGN KEY ("cruise_id") REFERENCES "cruises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
