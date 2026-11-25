/**
 * The facts behind the "visible problems" checks (owner, 2026-11-23): straight
 * lines no router can fix, a silent phone, a stalled visit scan and entries
 * that were tracked wrongly. Loaded once per request beside `context.ts`, from
 * stored rows only — counts on indexed columns, never a provider call.
 *
 * Every count is the number the copy names ("N Bahnfahrten als Luftlinie"), so
 * it is computed with the same rule the entry list (`problemEntries.ts`) uses:
 * the two must never disagree about what they found.
 */
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { ReadinessFactError } from "./factError";
import { isServiceDisabledByAdmin } from "../externalServices/policy";
import { LEG_MODES, type LegMode } from "../tour/tourDistance";
import { resolveRouting } from "../tour/routing/resolveProvider";
import { isRoutableMode } from "../tour/routing/types";
import { derivationProgress } from "../travtrack/derivationProgress";
import { VISITS_BIT } from "../travtrack/dirtyDays";
import { questionableDayCount } from "../travtrack/bestSource/choices";
import { PROBLEM_RULES, type ProblemRuleId } from "./problemEntries";

/** Legs a routing provider would draw: the reroute run's own rule (`rerouteItems.ts`). */
export const ROUTABLE_LEG_MODES: readonly LegMode[] = LEG_MODES.filter((m) => isRoutableMode(m));

/** A visit day still open after this long is not "the next run will get it" any more. */
export const VISIT_BACKLOG_GRACE_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface InstanceProblemFacts {
  railRouterConfigured: boolean;
  /** Rail journeys of every account drawn as a chord (with or without a router). */
  railStraight: number;
  /** Of those, the ones no re-route pass has tried yet or that changed since: what a pass can still fix. */
  railStraightUntried: number;
  /** Of those, the ones the last pass could not draw (a recorded reason): only a hand-drawn line helps. */
  railRerouteMissed: number;
  /** A road provider answers for the instance itself (admin global key or own OSRM). */
  roadRoutingEffective: boolean;
  /** Straight routable legs and coach rides of every account; counted only while no provider answers. */
  roadStraight: number;
  /**
   * Some account or the instance holds a routing key, yet routing is switched
   * off ("Aus") or the selected provider cannot answer for the instance.
   */
  routingKeyWithoutProvider: boolean;
  demoAccounts: number;
}

export interface AccountProblemFacts {
  hasSecondFactor: boolean;
  /** The account's own chords; null while a rail router is set (the check does not apply). */
  railStraight: number | null;
  /** The account's own straight legs and coach rides; null while routing works for it. */
  roadStraight: number | null;
  lastPointAt: Date | null;
  /** Visit-scan days older than the grace period that are still open. */
  visitBacklogDays: number;
  /** Recorded days whose country/month/explored figures are still being derived (after an import). */
  derivationPendingDays: number;
  /** Days whose track sources are questionable (`travtrack/bestSource/choices.ts`). */
  questionableTrackDays: number;
  /** The "falsch getrackt" counts, by check id (`problemEntries.ts`). */
  entries: Readonly<Record<ProblemRuleId, number>>;
}

/**
 * Whether a road provider answers, by `resolveRouting` itself (fix/routing-auto:
 * an unset provider is "Automatisch", so a stored key routes without a choice).
 * Without a user it is the instance's own answer: instance keys and the own server.
 */
async function roadRoutingWorks(userId?: string): Promise<boolean> {
  return (await resolveRouting(userId)).provider !== null;
}

const straightLegs = (userId?: string) =>
  prisma.tripRouteLeg.count({
    where: {
      source: "straight",
      mode: { in: [...ROUTABLE_LEG_MODES] },
      ...(userId ? { route: { userId } } : {}),
    },
  });
const straightBus = (userId?: string) =>
  prisma.busJourney.count({ where: { geometrySource: "straight", ...(userId ? { userId } : {}) } });
const straightRail = (userId?: string, miss?: "missed" | "untried") =>
  prisma.railJourney.count({
    where: {
      geometrySource: "straight",
      ...(userId ? { userId } : {}),
      ...(miss === "missed" ? { rerouteMissReason: { not: null } } : {}),
      ...(miss === "untried" ? { rerouteMissReason: null } : {}),
    },
  });

export async function loadInstanceProblemFacts(): Promise<InstanceProblemFacts> {
  const [admin, demoAccounts, keyHolder, routingOff, instanceRouting] = await Promise.all([
    prisma.adminSettings.findFirst({
      orderBy: { id: "asc" },
      select: {
        railRoutingUrl: true,
        globalOpenrouteserviceApiKey: true,
        globalGraphhopperApiKey: true,
      },
    }),
    prisma.user.count({ where: { isDemo: true } }),
    prisma.userSettings.findFirst({
      where: {
        OR: [{ openrouteserviceApiKey: { not: null } }, { graphhopperApiKey: { not: null } }],
      },
      select: { userId: true },
    }),
    isServiceDisabledByAdmin("selfHostedRouting"),
    resolveRouting(),
  ]);
  const railRouterConfigured = !!admin?.railRoutingUrl && !routingOff;
  const roadRoutingEffective = instanceRouting.provider !== null;
  const [railStraight, railRerouteMissed, legs, bus] = await Promise.all([
    straightRail(),
    straightRail(undefined, "missed"),
    roadRoutingEffective ? 0 : straightLegs(),
    roadRoutingEffective ? 0 : straightBus(),
  ]);
  const anyKey =
    keyHolder !== null || !!admin?.globalOpenrouteserviceApiKey || !!admin?.globalGraphhopperApiKey;
  return {
    railRouterConfigured,
    railStraight,
    railStraightUntried: railStraight - railRerouteMissed,
    railRerouteMissed,
    roadRoutingEffective,
    roadStraight: legs + bus,
    routingKeyWithoutProvider:
      anyKey && (instanceRouting.mode === "off" || instanceRouting.hint === "selectedUnavailable"),
    demoAccounts,
  };
}

/** Open visit days (the `VISITS_BIT` of the dirty-day protocol) older than the grace period. */
async function visitBacklog(userId: string, now: Date): Promise<number> {
  const before = new Date(now.getTime() - VISIT_BACKLOG_GRACE_DAYS * DAY_MS);
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM travtrack_dirty_days
    WHERE user_id = ${userId} AND (done & ${VISITS_BIT}) = 0 AND day < ${before}::date`;
  return Number(rows[0]?.n ?? 0);
}

/**
 * One count per entry rule, each on its own: a rule whose query fails reads as
 * unavailable (its check shows "Prüfung fehlgeschlagen"), the others still count.
 */
async function entryCountsOf(userId: string): Promise<Readonly<Record<ProblemRuleId, number>>> {
  const ids = Object.keys(PROBLEM_RULES) as ProblemRuleId[];
  const results = await Promise.allSettled(ids.map((id) => PROBLEM_RULES[id].count(userId)));
  const entries = {} as Record<ProblemRuleId, number>;
  ids.forEach((id, i) => {
    const r = results[i];
    if (r.status === "fulfilled") {
      entries[id] = r.value;
      return;
    }
    logger.error(
      { rule: id, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
      "readiness: an entry rule failed to count; its check shows as failed"
    );
    Object.defineProperty(entries, id, {
      enumerable: true,
      get: () => {
        throw new ReadinessFactError(`entries.${id}`, r.reason);
      },
    });
  });
  return entries;
}

export async function loadAccountProblemFacts(
  userId: string,
  instance: InstanceProblemFacts,
  now: Date
): Promise<AccountProblemFacts> {
  const roadWorks = instance.roadRoutingEffective || (await roadRoutingWorks(userId));
  const [user, passkey, rail, legs, bus, point, backlog, entryCounts, derivation, questionable] =
    await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabledAt: true } }),
      prisma.webAuthnCredential.findFirst({ where: { userId }, select: { id: true } }),
      instance.railRouterConfigured ? null : straightRail(userId),
      roadWorks ? null : straightLegs(userId),
      roadWorks ? null : straightBus(userId),
      prisma.travTrackPoint.findFirst({
        where: { userId },
        orderBy: [{ t: "desc" }, { seq: "desc" }],
        select: { t: true },
      }),
      visitBacklog(userId, now),
      entryCountsOf(userId),
      derivationProgress(userId),
      questionableDayCount(userId),
    ]);
  return {
    hasSecondFactor: user?.twoFactorEnabledAt != null || passkey !== null,
    railStraight: rail,
    roadStraight: legs === null || bus === null ? null : legs + bus,
    lastPointAt: point?.t ?? null,
    visitBacklogDays: backlog,
    derivationPendingDays: derivation.pendingDays,
    questionableTrackDays: questionable,
    entries: entryCounts,
  };
}
