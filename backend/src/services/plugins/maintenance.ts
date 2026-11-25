/**
 * Location maintenance through a plugin (owner 2026-11-24; spec
 * 2026-11-23-plugins-and-calendar.md, "Maintenance"): the plugin lists rows of
 * its own data without a usable position and proposes positions; TravStats
 * shows them and forwards the user's confirmed choice. Nothing is written
 * without that choice, and only the plugin writes — into its own data.
 *
 * Candidate stops: TravStats sends the account's venue-named TravTrack stops
 * with each proposals request, and the plugin matches them by name. That way
 * the plugin needs no location history of its own and keeps none; the stops
 * leave only on this explicit request, only to the account's own plugin, at the
 * plugin's precision, and never at 1 km (a venue name would undo the rounding).
 */
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { SuggestionPlugin } from "../../prisma";
import type { FetchLike } from "../egress/boundedFetch";
import { travTrackDerivationAllowed } from "../locationEvidence/allowed";
import { roundTo } from "./ask";
import { fetchFailure, headersFor, send, type PluginFailure } from "./client";
import {
  MAINTENANCE_MAX_STOPS,
  PLUGIN_CAPABILITY_MAINTENANCE,
  pluginHelloSchema,
  type PluginHello,
} from "./contract";
import { callMaintenance, type MaintenanceAction } from "./maintenanceClient";
import { targetOf, type Precision } from "./registry";

export const STOP_LOOKBACK_DAYS = 730;
const DAY_MS = 86_400_000;

export type StopsWithheld = "precision" | "travtrackOff" | null;

/** The account's venue-named TravTrack stops, newest first, deduplicated, as they may leave. */
export async function candidateStops(
  userId: string,
  precision: Precision,
  now = Date.now()
): Promise<{
  stops: { venueName: string; lat: number; lon: number; start: string; end: string }[];
  withheld: StopsWithheld;
}> {
  if (precision === "1km") return { stops: [], withheld: "precision" };
  if ((await travTrackDerivationAllowed(userId)) !== "ok")
    return { stops: [], withheld: "travtrackOff" };
  const rows = await prisma.dawarichStay.findMany({
    where: {
      userId,
      provider: "travtrack",
      name: { not: null },
      startAt: { gte: new Date(now - STOP_LOOKBACK_DAYS * DAY_MS) },
    },
    select: { name: true, lat: true, lon: true, startAt: true, endAt: true, evidence: true },
    orderBy: [{ startAt: "desc" }, { id: "asc" }],
    take: MAINTENANCE_MAX_STOPS * 2,
  });
  const seen = new Set<string>();
  const stops = [];
  for (const r of rows) {
    const createdFrom = (r.evidence as { createdFrom?: unknown } | null)?.createdFrom;
    // A finding a plugin named would only echo the plugin back to itself.
    if (typeof createdFrom === "string" && createdFrom.startsWith("plugin:")) continue;
    const venueName = (r.name ?? "").trim().slice(0, 200);
    if (!venueName || venueName === "—") continue;
    const lat = roundTo(r.lat, precision);
    const lon = roundTo(r.lon, precision);
    const key = `${venueName.toLowerCase()}|${lat}|${lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stops.push({
      venueName,
      lat,
      lon,
      start: r.startAt.toISOString(),
      end: r.endAt.toISOString(),
    });
    if (stops.length >= MAINTENANCE_MAX_STOPS) break;
  }
  return { stops, withheld: null };
}

export type HelloProbe =
  | { kind: "ok"; hello: PluginHello }
  /** The plugin answered, but offers no (valid) hello: no capabilities. */
  | { kind: "none" }
  | { kind: "failed"; reason: PluginFailure };

/**
 * The signed hello, keeping its failure: a refused signature or an unreachable
 * plugin must reach the user as itself, not as "this plugin offers nothing".
 */
export async function probeHello(
  plugin: SuggestionPlugin,
  fetchImpl?: FetchLike
): Promise<HelloProbe> {
  const started = Date.now();
  const target = await targetOf(plugin);
  const { headers } = headersFor(target, "GET", "");
  let res;
  try {
    res = await send(target, "GET", "", headers, fetchImpl);
  } catch (error) {
    const f = fetchFailure(error, started);
    return f.kind === "failed" ? { kind: "failed", reason: f.reason } : { kind: "none" };
  }
  if (res.status === 401 || res.status === 403) return { kind: "failed", reason: "auth" };
  if (res.status === 429) return { kind: "failed", reason: "rateLimited" };
  if (res.status >= 500) return { kind: "failed", reason: "server" };
  if (res.status !== 200) return { kind: "none" };
  try {
    const parsed = pluginHelloSchema.safeParse(JSON.parse(res.body.toString("utf8")));
    return parsed.success ? { kind: "ok", hello: parsed.data } : { kind: "none" };
  } catch {
    return { kind: "none" };
  }
}

export const offersMaintenance = (p: HelloProbe): boolean =>
  p.kind === "ok" && Boolean(p.hello.capabilities?.includes(PLUGIN_CAPABILITY_MAINTENANCE));

/** 400 PLUGIN_FAILED when the hello fails, 409 PLUGIN_NO_MAINTENANCE when it lacks the capability. */
export async function assertMaintenanceCapable(
  plugin: SuggestionPlugin,
  fetchImpl?: FetchLike
): Promise<void> {
  const probe = await probeHello(plugin, fetchImpl);
  if (probe.kind === "failed") throw new AppError(probe.reason, 400, "PLUGIN_FAILED");
  if (!offersMaintenance(probe)) throw new AppError("unsupported", 409, "PLUGIN_NO_MAINTENANCE");
}

/** One maintenance call; a failure becomes a 400 PLUGIN_FAILED with the reason in `error`. */
export async function runMaintenance(
  plugin: SuggestionPlugin,
  action: MaintenanceAction,
  payload: Record<string, unknown>,
  fetchImpl?: FetchLike
) {
  const outcome = await callMaintenance(await targetOf(plugin), action, payload, fetchImpl);
  if (outcome.kind === "failed") {
    const status = outcome.reason === "unsupported" ? 409 : 400;
    throw new AppError(
      outcome.reason,
      status,
      outcome.reason === "unsupported" ? "PLUGIN_NO_MAINTENANCE" : "PLUGIN_FAILED"
    );
  }
  return outcome.data;
}
