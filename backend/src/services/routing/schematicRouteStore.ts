import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { z } from "zod";
import type { SchematicRoute } from "../schematicRouter";
import { RouteStore, routeDirectory } from "./routeStore";
const schema = z.object({
  waypoints: z
    .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
    .min(2)
    .max(200_000),
  protectedPrefixCount: z.number().int().nonnegative(),
  protectedSuffixCount: z.number().int().nonnegative(),
  routed: z.literal(true),
  method: z.enum(["short_hop", "maritime_graph", "coarse_a_star", "direct"]),
});
const SCHEMATIC_HOT_ROUTES = 5_000;
export function createSchematicRouteStore(): RouteStore<SchematicRoute> {
  // The store's hot set is the only in-memory route cache (the 5,000-entry LRU
  // that used to sit in front of it was dropped, forgejo#384 MEM-8), so it
  // carries that capacity.
  return new RouteStore<SchematicRoute>(
    routeDirectory("sea"),
    (value) => {
      const parsed = schema.safeParse(value);
      return parsed.success ? parsed.data : null;
    },
    SCHEMATIC_HOT_ROUTES
  );
}

/** Bump when the routing algorithm changes; data changes are hashed below. */
const SCHEMATIC_ROUTE_POLICY = "schematic-v1";
const DATA_DIRECTORY = path.resolve(__dirname, "..", "..", "..", "data");
const SCHEMATIC_DATA_FILES = [
  path.join(DATA_DIRECTORY, "marnet", "marnet.geojson"),
  path.join(DATA_DIRECTORY, "land-mask.bin"),
];

/** Content hash of the files a route was computed from. */
export function dataFingerprint(files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const file of files) hash.update(readFileSync(file)).update("\0");
  return hash.digest("hex").slice(0, 16);
}

let version: string | null = null;
/**
 * Part of every sea-route key. Routes were stored forever under a fixed
 * "schematic-v1" key, so an updated shipping-lane graph or land mask was never
 * used for any port pair already routed once.
 */
export function schematicRouteVersion(): string {
  version ??= `${SCHEMATIC_ROUTE_POLICY}:${dataFingerprint(SCHEMATIC_DATA_FILES)}`;
  return version;
}
