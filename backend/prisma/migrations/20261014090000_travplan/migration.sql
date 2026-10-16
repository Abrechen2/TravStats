-- Additive planning storage. Existing domain records and counting are untouched.
CREATE TABLE "travel_plans" (
 "id" TEXT NOT NULL, "create_ref" TEXT NOT NULL, "trip_id" TEXT NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1, "state" JSONB NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "travel_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "travel_plans_create_ref_key" ON "travel_plans"("create_ref");
CREATE UNIQUE INDEX "travel_plans_trip_id_key" ON "travel_plans"("trip_id");
ALTER TABLE "travel_plans" ADD CONSTRAINT "travel_plans_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "travel_plan_mutations" (
 "id" TEXT NOT NULL,"plan_id" TEXT NOT NULL,"client_ref" TEXT NOT NULL,"payload_hash" TEXT NOT NULL,
 "base_revision" INTEGER NOT NULL,"revision" INTEGER NOT NULL,"before" JSONB NOT NULL,"result" JSONB NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "travel_plan_mutations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "travel_plan_mutations_plan_id_client_ref_key" ON "travel_plan_mutations"("plan_id","client_ref");
CREATE INDEX "travel_plan_mutations_plan_id_created_at_idx" ON "travel_plan_mutations"("plan_id","created_at");
ALTER TABLE "travel_plan_mutations" ADD CONSTRAINT "travel_plan_mutations_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "travel_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "travel_plan_proposals" (
 "id" TEXT NOT NULL,"plan_id" TEXT NOT NULL,"base_revision" INTEGER NOT NULL,"input_hash" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending',"provider" TEXT NOT NULL,"model" TEXT NOT NULL,"content" JSONB NOT NULL,
 "expires_at" TIMESTAMP(3) NOT NULL,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "travel_plan_proposals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "travel_plan_proposals_plan_id_created_at_idx" ON "travel_plan_proposals"("plan_id","created_at");
ALTER TABLE "travel_plan_proposals" ADD CONSTRAINT "travel_plan_proposals_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "travel_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "travel_plan_config" (
 "id" TEXT NOT NULL DEFAULT 'default',"enabled" BOOLEAN NOT NULL DEFAULT false,
 "ai_daily_limit" INTEGER NOT NULL DEFAULT 10,"weather_daily_limit" INTEGER NOT NULL DEFAULT 20,
 "updated_at" TIMESTAMP(3) NOT NULL,CONSTRAINT "travel_plan_config_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "travel_plan_usage" (
 "id" TEXT NOT NULL,"user_id" TEXT NOT NULL,"day" DATE NOT NULL,"kind" TEXT NOT NULL,"count" INTEGER NOT NULL DEFAULT 0,
 CONSTRAINT "travel_plan_usage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "travel_plan_usage_user_id_day_kind_key" ON "travel_plan_usage"("user_id","day","kind");
ALTER TABLE "travel_plan_usage" ADD CONSTRAINT "travel_plan_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
