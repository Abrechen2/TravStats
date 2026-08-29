import { z } from "zod";

import { LEG_MODES } from "../services/tour/tourDistance";
import { ROUTING_PROVIDER_IDS } from "../services/tour/routing/types";

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

/**
 * Validate and canonicalise the operator-supplied "custom" routing base URL
 * (`AdminSettings.routingCustomUrl`, used only when `routingProvider ==
 * "custom"` — a self-hosted OSRM instance, see
 * `services/tour/routing/customOsrm.ts`).
 *
 * DELIBERATE NON-RESTRICTION (SSRF egress): there is intentionally NO block
 * on loopback / link-local / private / RFC1918 hosts here. This mirrors
 * `normalizeImmichBaseUrl` (services/immich/types.ts) exactly, and for the
 * same reason: a self-hosted OSRM instance lives on the operator's LAN by
 * design (often a private RFC1918 or `.local` address), so a private-IP
 * filter would break the primary use case. The URL is admin-supplied, not
 * attacker-chosen, in the single-tenant deployment this targets. An operator
 * who exposes this configuration to untrusted users on a multi-tenant
 * instance MUST restrict egress at the network layer instead. Do not
 * re-flag this without changing that threat model.
 */
export function normalizeRoutingCustomUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("Custom routing URL is not a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Custom routing URL must use http:// or https://");
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${path}`;
}

/** Zod wrapper around {@link normalizeRoutingCustomUrl} for use at a request boundary. */
const routingCustomUrlSchema = z
  .string()
  .trim()
  .min(1)
  .transform((raw, ctx) => {
    try {
      return normalizeRoutingCustomUrl(raw);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "Invalid custom routing URL",
      });
      return z.NEVER;
    }
  });

/**
 * Admin-only routing configuration (Phase 3): which provider is active, and
 * — only meaningful when `routingProvider === "custom"` — the self-hosted
 * OSRM base URL. `null` clears the field; `undefined` (the key omitted
 * entirely) leaves it unchanged, matching every other settings PUT in this
 * codebase.
 */
export const routingSettingsSchema = z
  .object({
    routingProvider: z.enum(ROUTING_PROVIDER_IDS).nullable().optional(),
    routingCustomUrl: routingCustomUrlSchema.nullable().optional(),
  })
  .partial();

export type RoutingSettingsInput = z.infer<typeof routingSettingsSchema>;
