import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import logger from "../../../utils/logger";
import { isSharedDemoUser } from "../../../utils/sharedDemo";
import { fetchBusLine } from "../../bus/busRouting";
import { routeStraightRide } from "../../bus/busRouteAgain";
import { findRunningJob, startJob } from "../../jobs/jobRegistry";
import { applyRoutedLegIfStillStraight, withTimeout } from "./autoRouteLegs";
import { providerCallGate, takeBulkProviderCall } from "./providerBudget";
import { resolveRouteProvider } from "./resolveProvider";
import {
  countRemaining,
  nextItem,
  type BusItem,
  type LegItem,
  type RerouteItem,
  type RerouteMode,
  type RunScope,
} from "./rerouteItems";
import { routeLegGeometry } from "./routeLeg";
import type { RouteFallbackReason, RouteProvider } from "./types";
import { asRoutableMode } from "./legMode";

/**
 * The bulk re-route (forgejo#436): routes the legs and coach rides still drawn
 * as a straight line (or, on request, all of them again) through the instance's
 * routing provider, as a background job whose state lives in `reroute_runs`.
 *
 * Rules it keeps, each one a defect the single-leg paths already had:
 *  - A failed or untrustworthy answer writes NOTHING: the stored geometry stays.
 *  - The write is conditional on the row being unchanged since it was read, so
 *    a line drawn or recorded while the provider answered is never replaced.
 *  - The provider's quota ends the run as `paused` with a cursor; the next UTC
 *    day continues from there (`resumeDueRerouteRuns`, hourly scheduler).
 *  - A cause that repeats for every following item (refused key, no provider)
 *    stops the run as `failed` with that cause instead of failing item by item.
 */

export type RerouteStatus = "running" | "paused" | "done" | "cancelled" | "failed";
export type RerouteFailureReason = RouteFallbackReason | "timeout" | "no_coordinates" | "changed";

export interface RerouteRunView {
  id: string;
  scope: "instance" | "roadtrip";
  routeId: string | null;
  mode: RerouteMode;
  status: RerouteStatus;
  total: number;
  processed: number;
  routed: number;
  kept: number;
  failureCounts: Record<string, number>;
  failureSample: Array<{ kind: string; id: string; reason: string }>;
  stopReason: string | null;
  resumeAfter: string | null;
  createdAt: string;
  finishedAt: string | null;
}

const ACTIVE = ["running", "paused"];

/** Latest failures kept on the row; the counts cover the whole run. */
const FAILURE_SAMPLE_MAX = 50;
/** This many provider errors or timeouts in a row mean the provider is down. */
const CONSECUTIVE_FAILURES_STOP = 5;
/** One provider call gets this long; the adapters carry no timeout of their own. */
const LEG_TIMEOUT_MS = 20_000;
/** A courtesy gap between calls, by provider (ORS ~40 calls/min, GraphHopper ~1/s). */
const PAUSE_MS: Record<string, number> = { openrouteservice: 1600, graphhopper: 1100, custom: 150 };
/** Reasons that repeat for every following item (a missing provider is caught before an item). */
const STOP_FAILED: readonly string[] = ["auth"];

export interface RunDeps {
  /** Test seam: replaces the pause between provider calls. */
  pauseMs?: (providerId: string) => number;
  /** Test seam: replaces the provider lookup. */
  resolveProvider?: (userId: string) => Promise<RouteProvider | null>;
  now?: () => Date;
}

const toView = (r: Prisma.RerouteRunGetPayload<object>): RerouteRunView => ({
  id: r.id,
  scope: r.scope === "roadtrip" ? "roadtrip" : "instance",
  routeId: r.routeId,
  mode: r.mode === "all" ? "all" : "straight",
  status: r.status as RerouteStatus,
  total: r.total,
  processed: r.processed,
  routed: r.routed,
  kept: r.kept,
  failureCounts: (r.failureCounts ?? {}) as Record<string, number>,
  failureSample: (r.failureSample ?? []) as RerouteRunView["failureSample"],
  stopReason: r.stopReason,
  resumeAfter: r.resumeAfter?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
});

/** 00:05 UTC of the day after `now`: the provider's quota counts per UTC day. */
export function nextQuotaWindow(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5));
}

const scopeOf = (r: { scope: string; routeId: string | null; mode: string }): RunScope => ({
  scope: r.scope === "roadtrip" ? "roadtrip" : "instance",
  routeId: r.routeId,
  mode: r.mode === "all" ? "all" : "straight",
});

/** What one item came to: a written line, or a kept one with the reason. */
type Outcome =
  | { kind: "routed" }
  | { kind: "kept"; reason: RerouteFailureReason }
  | { kind: "stop"; reason: RouteFallbackReason };

async function routeLeg(
  item: LegItem,
  provider: RouteProvider,
  gate: () => boolean
): Promise<Outcome> {
  const mode = asRoutableMode(item.mode);
  const { from, to } = item;
  if (
    mode === null ||
    from.lat === null ||
    from.lon === null ||
    to.lat === null ||
    to.lon === null
  ) {
    return { kind: "kept", reason: "no_coordinates" };
  }
  const routed = await withTimeout(
    routeLegGeometry(
      provider,
      {
        from: { lat: from.lat, lon: from.lon },
        to: { lat: to.lat, lon: to.lon },
        mode,
        vehicle: item.vehicle,
      },
      gate
    ),
    LEG_TIMEOUT_MS
  );
  if (routed === null) return { kind: "kept", reason: "timeout" };
  if (routed.source !== "routed")
    return { kind: "kept", reason: routed.fallbackReason ?? "provider_error" };
  const written = await applyRoutedLegIfStillStraight(item.id, item.updatedAt, routed, item.source);
  return written ? { kind: "routed" } : { kind: "kept", reason: "changed" };
}

async function routeBus(
  item: BusItem,
  mode: RerouteMode,
  provider: RouteProvider,
  gate: () => boolean
): Promise<Outcome> {
  const report = await routeStraightRide(
    item.userId,
    item.id,
    (ends) => fetchBusLine(item.userId, ends, gate, provider),
    mode === "all" ? ["straight", "road"] : ["straight"]
  );
  if (!report) return { kind: "kept", reason: "changed" };
  if (report.outcome === "routed") return { kind: "routed" };
  if (report.outcome === "unchanged") return { kind: "kept", reason: "changed" };
  if (report.lineMiss === "rate_limited") return { kind: "stop", reason: "rate_limited" };
  return { kind: "kept", reason: report.fallback ?? "provider_error" };
}

async function loadRun(id: string) {
  return prisma.rerouteRun.findUnique({ where: { id } });
}

/**
 * Walk the run from its cursor until it ends, pauses, fails or is cancelled.
 * The row is the only state: this can be called again for a paused run.
 */
export async function executeRerouteRun(
  runId: string,
  reportProgress: (done: number, total: number) => void = () => undefined,
  deps: RunDeps = {}
): Promise<RerouteRunView> {
  const now = deps.now ?? (() => new Date());
  const pauseMs = deps.pauseMs ?? ((id: string) => PAUSE_MS[id] ?? 150);
  const resolve = deps.resolveProvider ?? resolveRouteProvider;
  let run = await loadRun(runId);
  if (!run) throw new Error("reroute run not found");
  const scope = scopeOf(run);
  const counts = { ...((run.failureCounts ?? {}) as Record<string, number>) };
  const sample = [...((run.failureSample ?? []) as RerouteRunView["failureSample"])];
  let { processed, routed, kept, cursor } = run;
  const remaining = await countRemaining(scope, cursor);
  let total = processed + remaining;
  // Conditional: a run cancelled between the scheduler's pick and this line stays cancelled.
  const claimed = await prisma.rerouteRun.updateMany({
    where: { id: runId, status: { in: ACTIVE } },
    data: { status: "running", stopReason: null, resumeAfter: null, total },
  });
  if (claimed.count === 0) return toView(run);
  const providers = new Map<string, RouteProvider | null>();
  const demo = new Map<string, boolean>();
  let consecutive = 0;
  let end: { status: RerouteStatus; stopReason?: string; resumeAfter?: Date } = { status: "done" };

  for (;;) {
    // Cancel is a status written by another request; read it before every item.
    run = await loadRun(runId);
    if (!run || run.status !== "running") {
      return run ? toView(run) : Promise.reject(new Error("reroute run vanished"));
    }
    const item: RerouteItem | null = await nextItem(scope, cursor);
    if (!item) break;

    if (!demo.has(item.userId)) demo.set(item.userId, await isSharedDemoUser(item.userId));
    let outcome: Outcome;
    let providerId = "custom";
    if (demo.get(item.userId)) {
      // The shared demo account never spends the instance's key.
      outcome = { kind: "kept", reason: "no_provider" };
    } else {
      if (!providers.has(item.userId)) providers.set(item.userId, await resolve(item.userId));
      const provider = providers.get(item.userId) ?? null;
      if (provider === null) {
        // One account without a usable provider is that account's lines kept; the
        // pass stops only when the starter has none either (routing is off).
        if ((await resolve(run.userId)) === null) {
          end = { status: "failed", stopReason: "no_provider" };
          break;
        }
        outcome = { kind: "kept", reason: "no_provider" };
      } else {
        providerId = provider.id;
        const gate =
          scope.scope === "instance"
            ? () => takeBulkProviderCall(provider.id, now())
            : providerCallGate(item.userId);
        try {
          outcome =
            item.kind === "leg"
              ? await routeLeg(item, provider, gate)
              : await routeBus(item, scope.mode, provider, gate);
        } catch (error) {
          logger.warn({
            operation: "reroute_run_item",
            runId,
            kind: item.kind,
            itemId: item.id,
            error: error instanceof Error ? error.message : String(error),
          });
          outcome = { kind: "kept", reason: "provider_error" };
        }
      }
    }

    const reason = outcome.kind === "routed" ? null : outcome.reason;
    // Quota: this item is NOT consumed; the next day tries it first.
    if (reason === "rate_limited") {
      end = { status: "paused", stopReason: "rate_limited", resumeAfter: nextQuotaWindow(now()) };
      break;
    }
    if (reason && STOP_FAILED.includes(reason) && !demo.get(item.userId)) {
      end = { status: "failed", stopReason: reason };
      break;
    }
    processed += 1;
    cursor = `${item.kind}:${item.id}`;
    if (outcome.kind === "routed") {
      routed += 1;
      consecutive = 0;
    } else if (outcome.kind === "kept") {
      kept += 1;
      counts[outcome.reason] = (counts[outcome.reason] ?? 0) + 1;
      sample.push({ kind: item.kind, id: item.id, reason: outcome.reason });
      if (sample.length > FAILURE_SAMPLE_MAX) sample.shift();
      consecutive =
        outcome.reason === "provider_error" || outcome.reason === "timeout" ? consecutive + 1 : 0;
    }
    total = Math.max(total, processed);
    await prisma.rerouteRun.update({
      where: { id: runId },
      data: {
        cursor,
        processed,
        routed,
        kept,
        total,
        failureCounts: counts as Prisma.InputJsonValue,
        failureSample: sample as unknown as Prisma.InputJsonValue,
      },
    });
    reportProgress(processed, total);
    if (consecutive >= CONSECUTIVE_FAILURES_STOP) {
      end = { status: "failed", stopReason: "provider_error" };
      break;
    }
    const wait = pauseMs(providerId);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  // Conditional on still running: a cancel that arrived during the last item stays a cancel.
  await prisma.rerouteRun.updateMany({
    where: { id: runId, status: "running" },
    data: {
      status: end.status,
      stopReason: end.stopReason ?? null,
      resumeAfter: end.resumeAfter ?? null,
      finishedAt: end.status === "paused" ? null : now(),
    },
  });
  const finished = await prisma.rerouteRun.findUniqueOrThrow({ where: { id: runId } });
  logger.info({
    operation: "reroute_run",
    runId,
    status: end.status,
    processed,
    routed,
    kept,
    stopReason: end.stopReason ?? null,
  });
  return toView(finished);
}

export type RerouteStart =
  | { kind: "started"; run: RerouteRunView }
  | { kind: "notConfigured" }
  /** An instance run is running or paused; its view is the answer. */
  | { kind: "alreadyActive"; run: RerouteRunView };

function launch(run: { id: string; userId: string }, deps?: RunDeps): void {
  startJob("routing.rerouteAll", run.userId, (progress) =>
    executeRerouteRun(run.id, progress, deps)
  );
}

/** Starts are serialized in this process so two clicks cannot both pass the active-run check. */
let startQueue: Promise<unknown> = Promise.resolve();

/** Create the run row and start its job; one active run per scope (and roadtrip). */
export function startRerouteRun(
  userId: string,
  input: RunScope,
  deps?: RunDeps
): Promise<RerouteStart> {
  const next = startQueue.then(() => startOne(userId, input, deps));
  startQueue = next.catch(() => undefined);
  return next;
}

async function startOne(userId: string, input: RunScope, deps?: RunDeps): Promise<RerouteStart> {
  const active = await prisma.rerouteRun.findFirst({
    where: {
      status: { in: ACTIVE },
      scope: input.scope,
      ...(input.scope === "roadtrip" ? { routeId: input.routeId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  if (active) return { kind: "alreadyActive", run: toView(active) };
  const provider = await (deps?.resolveProvider ?? resolveRouteProvider)(userId);
  if (!provider) return { kind: "notConfigured" };
  const row = await prisma.rerouteRun.create({
    data: {
      userId,
      scope: input.scope,
      routeId: input.routeId,
      mode: input.mode,
      status: "running",
      total: await countRemaining(input, null),
    },
  });
  launch(row, deps);
  return { kind: "started", run: toView(row) };
}

export async function latestInstanceRun(): Promise<RerouteRunView | null> {
  const row = await prisma.rerouteRun.findFirst({
    where: { scope: "instance" },
    orderBy: { createdAt: "desc" },
  });
  return row ? toView(row) : null;
}

/** The latest run on one roadtrip; the route is already checked as the caller's. */
export async function latestRoadtripRun(
  userId: string,
  routeId: string
): Promise<RerouteRunView | null> {
  const row = await prisma.rerouteRun.findFirst({
    where: { userId, scope: "roadtrip", routeId },
    orderBy: { createdAt: "desc" },
  });
  return row ? toView(row) : null;
}

/** A run the caller started (a stranger's run reads as no run). */
export async function getRerouteRun(id: string, userId: string): Promise<RerouteRunView | null> {
  const row = await prisma.rerouteRun.findFirst({ where: { id, userId } });
  return row ? toView(row) : null;
}

/**
 * Cancel: the status is the signal the walking job reads before its next item.
 * A running item finishes (its write is conditional anyway); nothing is rolled back.
 */
export async function cancelRerouteRun(
  id: string,
  owner: { userId: string } | { scope: "instance" }
): Promise<RerouteRunView | null> {
  const run = await prisma.rerouteRun.findFirst({ where: { id, ...owner } });
  if (!run) return null;
  if (!ACTIVE.includes(run.status)) return toView(run);
  const row = await prisma.rerouteRun.update({
    where: { id },
    data: { status: "cancelled", resumeAfter: null, finishedAt: new Date() },
  });
  return toView(row);
}

/**
 * Pick up every paused run whose quota window has opened, and every run left
 * `running` by a process that is gone. Called hourly and once at boot.
 */
export async function resumeDueRerouteRuns(
  now: Date = new Date(),
  deps?: RunDeps
): Promise<number> {
  if (findRunningJob(["routing.rerouteAll"])) return 0;
  const due = await prisma.rerouteRun.findMany({
    where: { OR: [{ status: "paused", resumeAfter: { lte: now } }, { status: "running" }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true },
  });
  // One job at a time keeps a provider's rate honest; the rest wait for the next tick.
  const next = due[0];
  if (!next) return 0;
  launch(next, deps);
  return 1;
}
