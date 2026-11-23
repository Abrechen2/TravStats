/**
 * Evaluators of the visible-problem checks (owner, 2026-11-23). Pure functions
 * of `ctx.problems` (`problemFacts.ts`); every one that counts hands its number
 * to the copy.
 *
 * A check applies only where it has something to say — a data check with
 * nothing found is not shown at all, rather than filling "bereit" with lines
 * the account never needed to read.
 */
import type { CheckId } from "../../shared/readinessCatalogue";
import type { ReadinessContext } from "./context";
import type { CheckImpl, Evaluation } from "./types";
import { PROBLEM_RULES, type ProblemRuleId } from "./problemEntries";

/** No position for this long while the phone records counts as silent. */
export const TRAVTRACK_SILENT_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

const counted = (count: number): Evaluation =>
  count > 0
    ? { status: "needsAction", checkedAt: null, count }
    : { status: "ready", checkedAt: null, count: 0 };

/** A count-only check: shown while it finds something. */
function countCheck(read: (ctx: ReadinessContext) => number | null): CheckImpl {
  return {
    appliesWhen: (ctx) => (read(ctx) ?? 0) > 0,
    evaluate: (ctx) => counted(read(ctx) ?? 0),
  };
}

const travtrackRecording = (ctx: ReadinessContext): boolean =>
  ctx.instance.travtrackOffered &&
  ctx.account.locationProvider === "travtrack" &&
  ctx.account.hasPairedDevice;

export const PROBLEM_CHECK_IMPLS: Readonly<
  Record<
    Extract<
      CheckId,
      | "admin.railRouter"
      | "admin.roadRouting"
      | "admin.routingKeyUnused"
      | "admin.twoFactor"
      | "admin.demoAccount"
      | "user.railStraight"
      | "user.roadStraight"
      | "user.travtrackSilent"
      | "user.visitScanBacklog"
    >,
    CheckImpl
  >
> = {
  "admin.railRouter": countCheck(({ problems }) =>
    problems.instance.railRouterConfigured ? null : problems.instance.railStraight
  ),
  "admin.roadRouting": countCheck(({ problems }) =>
    problems.instance.roadRoutingEffective ? null : problems.instance.roadStraight
  ),
  "admin.routingKeyUnused": {
    appliesWhen: ({ problems }) => problems.instance.routingKeyWithoutProvider,
    evaluate: ({ problems }) =>
      problems.instance.routingKeyWithoutProvider
        ? { status: "needsAction", checkedAt: null }
        : { status: "ready", checkedAt: null },
  },
  "admin.twoFactor": {
    // The viewer's own account: an admin item is only ever shown to an admin.
    appliesWhen: ({ isAdmin }) => isAdmin,
    evaluate: ({ problems }) => ({
      status: problems.account.hasSecondFactor ? "ready" : "needsAction",
      checkedAt: null,
    }),
  },
  "admin.demoAccount": countCheck(({ problems }) => problems.instance.demoAccounts),
  "user.railStraight": countCheck(({ problems }) => problems.account.railStraight),
  "user.roadStraight": countCheck(({ problems }) => problems.account.roadStraight),
  "user.travtrackSilent": {
    // Only a phone that has recorded before can have gone quiet.
    appliesWhen: (ctx) => travtrackRecording(ctx) && ctx.problems.account.lastPointAt !== null,
    evaluate: ({ problems, now }) => {
      const last = problems.account.lastPointAt;
      if (!last) return { status: "unknown", checkedAt: null };
      const silent = now.getTime() - last.getTime() > TRAVTRACK_SILENT_HOURS * HOUR_MS;
      return { status: silent ? "needsAction" : "ready", checkedAt: last };
    },
  },
  "user.visitScanBacklog": countCheck(({ problems }) => problems.account.visitBacklogDays),
};

/** One count check per entry rule: the rule decides what is wrong, the check only shows it. */
export const ENTRY_CHECK_IMPLS = Object.fromEntries(
  (Object.keys(PROBLEM_RULES) as ProblemRuleId[]).map((id) => [
    id,
    countCheck(({ problems }) => problems.account.entries[id]),
  ])
) as Readonly<Record<ProblemRuleId, CheckImpl>>;
