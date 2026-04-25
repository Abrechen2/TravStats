-- Drop the orphan cruise_route_cache table. The schematic-routes
-- pipeline (feat/schematic-routes) replaces the Hybrid-v2 sea-router
-- and no longer caches per-port-pair geometry — every leg is computed
-- on demand by `schematicRouter.computeSchematicRoute` (sub-millisecond
-- on the 1° grid). The table has been a no-op since the seaRouter.ts
-- delete in commit b849030.

DROP TABLE IF EXISTS "cruise_route_cache";
