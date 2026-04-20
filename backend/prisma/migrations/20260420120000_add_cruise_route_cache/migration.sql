-- CreateTable
CREATE TABLE "cruise_route_cache" (
    "dep_port_id" INTEGER NOT NULL,
    "arr_port_id" INTEGER NOT NULL,
    "geometry" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cruise_route_cache_pkey" PRIMARY KEY ("dep_port_id","arr_port_id")
);
