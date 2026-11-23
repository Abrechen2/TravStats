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
import { getApiKey } from "../apiKeyResolver";
import { isServiceDisabledByAdmin } from "../externalServices/policy";
import { LEG_MODES, type LegMode } from "../tour/tourDistance";
import { isRoutableMode, ROUTING_PROVIDER_IDS, type RoutingProviderId } from "../tour/routing/types";
import { VISITS_BIT } from "../travtrack/dirtyDays";
import { PROBLEM_RULES, type ProblemRuleId } from "./problemEntries";

/** Legs a routing provider would draw: the reroute run's own rule (`rerouteItems.ts`). */
export const ROUTABLE_LEG_MODES: readonly LegMode[] = LEG_MODES.filter((m) => isRoutableMode(m));

/** A visit day still open after this long is not "the next run will get it" any more. */
export const VISIT_BACKLOG_GRACE_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface InstanceProblemFacts {
  railRouterConfigured: boolean;
  /** Rail journeys of every account drawn as a chord; counted only while no router is set. */
  railStraight: number;
  /** A road provider answers for the instance itself (admin global key or own OSRM). */
  roadRoutingEffective: boolean;
  /** Straight routable legs and coach rides of every account; counted only while no provider answers. */
  roadStraight: number;
  /** Some account or the instance holds a routing key, yet no provider is selected. */
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
  /** The "falsch getrackt" counts, by check id (`problemEntries.ts`). */
  entries: Readonly<Record<ProblemRuleId, number>>;
}

function isProviderId(v: string | null | undefined): v is RoutingProviderId {
  return !!v && (ROUTING_PROVIDER_IDS as readonly string[]).includes(v);
}

/**
 * Whether a road provider answers, by the rule of `resolveRouteProvider` but
 * without building a client or logging a warning on every page read.
 */
async function roadRoutingWorks(
  provider: string | null,
  customUrl: string | null,
  userId?: string
): Promise<boolean> {
  if (!isProviderId(provider)) return false;
  if (provider === "custom") {
    return !!customUrl && !(await isServiceDisabledByAdmin("selfHostedRouting"));
  }
  return (await getApiKey(provider, userId)) !== null;
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
const straightRail = (userId?: string) =>
  prisma.railJourney.count({
    where: { geometrySource: "straight", ...(userId ? { userId } : {}) },
  });

export async function loadInstanceProblemFacts(): Promise<InstanceProblemFacts> {
  const [admin, demoAccounts, keyHolder, routingOff] = await Promise.all([
    prisma.adminSettings.findFirst({
      orderBy: { id: "asc" },
      select: {
        railRoutingUrl: true,
        routingProvider: true,
        routingCustomUrl: true,
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
  ]);
  const railRouterConfigured = !!admin?.railRoutingUrl && !routingOff;
  const roadRoutingEffective = await roadRoutingWorks(
    admin?.routingProvider ?? null,
    admin?.routingCustomUrl ?? null
  );
  const [railStraight, legs, bus] = await Promise.all([
    railRouterConfigured ? 0 : straightRail(),
    roadRoutingEffective ? 0 : straightLegs(),
    roadRoutingEffective ? 0 : straightBus(),
  ]);
  const anyKey =
    keyHolder !== null ||
    !!admin?.globalOpenrouteserviceApiKey ||
    !!admin?.globalGraphhopperApiKey;
  return {
    railRouterConfigured,
    railStraight,
    roadRoutingEffective,
    roadStraight: legs + bus,
    routingKeyWithoutProvider: anyKey && !isProviderId(admin?.routingProvider),
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

export async function loadAccountProblemFacts(
  userId: string,
  instance: InstanceProblemFacts,
  now: Date
): Promise<AccountProblemFacts> {
  const settings = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { routingProvider: true, routingCustomUrl: true },
  });
  const roadWorks =
    instance.roadRoutingEffective ||
    (await roadRoutingWorks(
      settings?.routingProvider ?? null,
      settings?.routingCustomUrl ?? null,
      userId
    ));
  const [
    user,
    passkey,
    rail,
    legs,
    bus,
    point,
    backlog,
    entryCounts,
  ] = await Promise.all([
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
    Promise.all(
      (Object.keys(PROBLEM_RULES) as ProblemRuleId[]).map(
        async (id) => [id, await PROBLEM_RULES[id].count(userId)] as const
      )
    ),
  ]);
  return {
    hasSecondFactor: user?.twoFactorEnabledAt != null || passkey !== null,
    railStraight: rail,
    roadStraight: legs === null || bus === null ? null : legs + bus,
    lastPointAt: point?.t ?? null,
    visitBacklogDays: backlog,
    entries: Object.fromEntries(entryCounts) as Record<ProblemRuleId, number>,
  };
}
