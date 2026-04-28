-- Cruise leg distance records.
--
-- One row per consecutive port-to-port hop within a cruise. Holds the
-- routed distance plus provenance metadata so we can re-compute when
-- the underlying router or data version changes (see Codex peer review
-- on cruise distance accuracy, 2026-04-27).
--
-- Hand-written migration. The schema.prisma in this repo has known drift
-- vs. existing migrations (see CLAUDE.md "Cruise migrations" gotcha);
-- generating via `prisma migrate dev` would bundle that drift.

-- CreateTable
CREATE TABLE "cruise_legs" (
    "id" TEXT NOT NULL,
    "cruise_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "from_port_id" INTEGER NOT NULL,
    "to_port_id" INTEGER NOT NULL,
    "distance_km" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "router_version" TEXT NOT NULL,
    "data_version" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "notes" TEXT,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cruise_legs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cruise_legs_cruise_id_ordinal_key" ON "cruise_legs"("cruise_id", "ordinal");

-- CreateIndex
CREATE INDEX "cruise_legs_cruise_id_idx" ON "cruise_legs"("cruise_id");

-- CreateIndex
CREATE INDEX "cruise_legs_from_port_id_idx" ON "cruise_legs"("from_port_id");

-- CreateIndex
CREATE INDEX "cruise_legs_to_port_id_idx" ON "cruise_legs"("to_port_id");

-- CreateIndex
CREATE INDEX "cruise_legs_method_idx" ON "cruise_legs"("method");

-- AddForeignKey
ALTER TABLE "cruise_legs" ADD CONSTRAINT "cruise_legs_cruise_id_fkey" FOREIGN KEY ("cruise_id") REFERENCES "cruises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cruise_legs" ADD CONSTRAINT "cruise_legs_from_port_id_fkey" FOREIGN KEY ("from_port_id") REFERENCES "ports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cruise_legs" ADD CONSTRAINT "cruise_legs_to_port_id_fkey" FOREIGN KEY ("to_port_id") REFERENCES "ports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
