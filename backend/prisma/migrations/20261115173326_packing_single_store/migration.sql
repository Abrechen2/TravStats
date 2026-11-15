-- AlterTable
ALTER TABLE "travel_plans" ADD COLUMN     "packing_migrated_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "packing_mutations" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "mutation_id" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packing_mutations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "packing_mutations_created_at_idx" ON "packing_mutations"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "packing_mutations_trip_id_actor_mutation_id_key" ON "packing_mutations"("trip_id", "actor", "mutation_id");

-- AddForeignKey
ALTER TABLE "packing_mutations" ADD CONSTRAINT "packing_mutations_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
