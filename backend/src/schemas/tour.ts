import { z } from "zod";

import { LEG_MODES } from "../services/tour/tourDistance";

/**
 * Validation for the tour endpoints.
 *
 * Phase 1 accepts only `straight` and `drawn` as a leg source; `routed` and
 * `track` are in the shared enum already so that phase 3 adds a value here
 * rather than a migration. A source the server cannot yet produce is
 * rejected at the boundary instead of being stored and rendered as a lie.
 */

const PHASE_1_SOURCES = ["straight", "drawn"] as const;

const coordinate = z
  .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .describe("[lon, lat] in GeoJSON order");

export const createRouteSchema = z.object({
  name: z.string().min(1).max(200),
  mode: z.enum(LEG_MODES),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  notes: z.string().max(20000).optional(),
  startOdometerKm: z.number().int().min(0).max(10_000_000).optional(),
  endOdometerKm: z.number().int().min(0).max(10_000_000).optional(),
});

export const updateRouteSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  mode: z.enum(LEG_MODES).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  notes: z.string().max(20000).nullable().optional(),
  orderIdx: z.number().int().min(0).max(10000).optional(),
  startOdometerKm: z.number().int().min(0).max(10_000_000).nullable().optional(),
  endOdometerKm: z.number().int().min(0).max(10_000_000).nullable().optional(),
});

/**
 * The complete ordered stop list of one section, replacing whatever was
 * there. The cap is a denial-of-service bound, not a product limit.
 *
 * A stop id may NOT repeat. `routeOrderIdx` is one Int per stop under
 * `@@unique([routeId, routeOrderIdx])` — a stop cannot hold two positions
 * at once. A loop is therefore modelled as two DISTINCT stops at the same
 * coordinates (e.g. "Gjendesheim, Start" / "Gjendesheim, zurück"), never
 * one stop listed twice; the return visit gets its own date and notes for
 * free that way, and `routeOrderIdx` stays contiguous as the schema
 * requires.
 */
export const assignStopsSchema = z.object({
  stopIds: z.array(z.string().uuid()).max(512),
}).refine((v) => new Set(v.stopIds).size === v.stopIds.length, {
  message: "A stop may appear only once in a route; model a loop as two distinct stops at the same place",
  path: ["stopIds"],
});

export const legOverrideSchema = z
  .object({
    source: z.enum(PHASE_1_SOURCES),
    mode: z.enum(LEG_MODES).optional(),
    waypoints: z.array(coordinate).min(2).max(256).optional(),
    drivingMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
    tollCost: z.number().min(0).max(1_000_000).nullable().optional(),
    currency: z.string().length(3).nullable().optional(),
  })
  .refine((v) => v.source !== "drawn" || (v.waypoints !== undefined && v.waypoints.length >= 2), {
    message: "A drawn leg needs at least two waypoints",
    path: ["waypoints"],
  })
  .refine((v) => v.source !== "straight" || v.waypoints === undefined, {
    message: "A straight leg has no waypoints",
    path: ["waypoints"],
  });

export type CreateRouteInput = z.infer<typeof createRouteSchema>;
export type UpdateRouteInput = z.infer<typeof updateRouteSchema>;
export type AssignStopsInput = z.infer<typeof assignStopsSchema>;
export type LegOverrideInput = z.infer<typeof legOverrideSchema>;
export type { LegMode, LegSource } from "../services/tour/tourDistance";
