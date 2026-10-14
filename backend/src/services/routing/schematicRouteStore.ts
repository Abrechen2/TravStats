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
export function createSchematicRouteStore(): RouteStore<SchematicRoute> {
  return new RouteStore<SchematicRoute>(routeDirectory("sea"), (value) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  });
}
