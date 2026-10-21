import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { routeFerryJourney } from "./ferryRouting";

/**
 * Sea routes for crossings stored as a straight line (owner, 2026-10-21).
 *
 * Since forgejo#323 a crossing is routed when it is saved; one stored before
 * that, or one whose routing failed at the time, stays a chord across land
 * (Kiel–Oslo over Denmark) until someone presses the detail page's button.
 * This routes them once, in the background, through the very path the button
 * takes (`routeFerryJourney`), so the rules that path holds hold here too:
 *
 * - **Only a chord is replaced.** A candidate is `geometrySource = "straight"`
 *   with no stored line. A crossing has no hand-drawn line of its own; the
 *   lines a person draws or records live on a linked roadtrip leg, and
 *   `syncFerryLeg` leaves a `drawn` or `track` leg alone.
 * - **A failure keeps what is stored.** The router answering no sea route, or
 *   throwing, writes nothing to the crossing; the attempt is recorded here.
 * - **A concurrent edit wins.** The write claims the version it was computed
 *   from, so a crossing edited meanwhile is a conflict, not an overwrite.
 * - **The line is a shared fact.** It propagates to every copy, as the button
 *   does; a copy routed that way is no longer a candidate.
 * - **A linked roadtrip leg** follows the crossing when its stops are the
 *   crossing's piers. A leg linked off the piers (its stops are towns) keeps
 *   its line, as on a PATCH (a3f47d427): the backfill moves no terminal, so a
 *   mismatch is how the link was made, not a stop moved under it.
 *
 * Retry policy, per crossing, across boots:
 * | Outcome    | Meaning                                  | Tried again        |
 * |------------|------------------------------------------|--------------------|
 * | `routed`   | a sea line was stored                    | never              |
 * | `straight` | the router found no sea route            | never (the button can) |
 * | `failed`   | the router threw, or a conflict          | after 1, 2, 4 days; final after `MAX_ATTEMPTS` |
 */

export type BackfillOutcome = "routed" | "straight" | "failed";

export interface BackfillReport {
  routed: number;
  straight: number;
  failed: number;
  /** Crossings looked at this call; 0 means nothing is left to try. */
  examined: number;
}

export interface BackfillOptions {
  limit: number;
  /** Ids already tried in this run; filled as crossings are tried. */
  attempted: Set<string>;
  /** One account only; the boot run covers every account. */
  userId?: string;
  now?: () => Date;
}

const DAY_MS = 24 * 3_600_000;
/** A failing crossing is tried this many times in all, then left for the button. */
export const MAX_ATTEMPTS = 4;

/** When a failed crossing may be tried again; null once it has had its tries. */
export function nextAttemptAfterFailure(attempts: number, now: Date): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  return new Date(now.getTime() + DAY_MS * 2 ** (attempts - 1));
}

const yieldToRequests = () => new Promise<void>((resolve) => setImmediate(resolve));

function reasonOf(error: unknown): string {
  if (error instanceof AppError) return error.code ?? `${error.statusCode} ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

async function record(
  ferryJourneyId: string,
  outcome: BackfillOutcome,
  reason: string | null,
  now: Date
): Promise<void> {
  const previous = await prisma.ferryRouteBackfill.findUnique({ where: { ferryJourneyId } });
  const attempts = (previous?.attempts ?? 0) + 1;
  const nextAttemptAt = outcome === "failed" ? nextAttemptAfterFailure(attempts, now) : null;
  const data = { outcome, attempts, attemptedAt: now, nextAttemptAt, reason };
  try {
    await prisma.ferryRouteBackfill.upsert({
      where: { ferryJourneyId },
      create: { ferryJourneyId, ...data },
      update: data,
    });
  } catch (error) {
    // The crossing was deleted meanwhile: there is nothing left to remember.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return;
    throw error;
  }
}

/** One batch of at most `limit` crossings. */
export async function backfillFerrySeaRoutes(options: BackfillOptions): Promise<BackfillReport> {
  const now = (options.now ?? (() => new Date()))();
  const report: BackfillReport = { routed: 0, straight: 0, failed: 0, examined: 0 };
  const candidates = await prisma.ferryJourney.findMany({
    where: {
      ...(options.userId !== undefined && { userId: options.userId }),
      geometrySource: "straight",
      geometry: { equals: Prisma.DbNull },
      id: { notIn: [...options.attempted] },
      OR: [{ routeBackfill: null }, { routeBackfill: { nextAttemptAt: { lte: now } } }],
    },
    select: { id: true, userId: true },
    orderBy: { id: "asc" },
    take: options.limit,
  });
  for (const { id, userId } of candidates) {
    options.attempted.add(id);
    report.examined++;
    let outcome: BackfillOutcome;
    let reason: string | null = null;
    try {
      const routed = await routeFerryJourney(userId, id, { onMismatch: "keep" });
      // "unchanged": no longer a chord by the time it was read — out of scope.
      if (routed.outcome === "unchanged") continue;
      outcome = routed.outcome;
    } catch (error) {
      outcome = "failed";
      reason = reasonOf(error);
      logger.warn(
        { operation: "ferry_route_backfill.failed", ferryJourneyId: id, reason },
        "sea route not computed; the crossing keeps its straight line"
      );
    }
    report[outcome]++;
    await record(id, outcome, reason, now);
    await yieldToRequests();
  }
  return report;
}
