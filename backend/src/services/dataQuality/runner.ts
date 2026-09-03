import type { DataQualityFlag, Prisma } from "@prisma/client";

import { prisma } from "../../db";
import logger from "../../utils/logger";
import { findAddressCountryMismatches } from "./checks/addressCountryMismatch";
import { findCoordinatesOutsideCountry } from "./checks/coordinatesOutsideCountry";
import { findReversedStayDates } from "./checks/stayDatesReversed";
import { findUndatedCountryEvidence } from "./checks/undatedCountryEvidence";
import { loadAccountSnapshot } from "./gather";
import { findingKey, type DataQualityFinding } from "./types";

/**
 * Run every check for one account and reconcile the inbox with the answer.
 *
 * **Re-running is the normal case, not the exception.** This will run after an
 * import, on demand from the inbox, and — when a schedule is wired — nightly.
 * So the operation is defined as "make the flags agree with the data", never
 * "insert what I found". A second copy of the same question is how an inbox
 * becomes something people stop reading, and the unique index makes that
 * impossible at the storage layer; this makes it impossible at the semantic one.
 *
 * The four transitions, and the reasoning behind the two that are not obvious:
 *
 * | Flag exists as | Finding reproduces | Result |
 * |---|---|---|
 * | — | yes | created `open` |
 * | `open` | yes | details refreshed |
 * | `open` | no | `resolved` — the disagreement is gone |
 * | `resolved` | yes | **re-opened** |
 * | `dismissed` | yes | untouched |
 *
 * **`resolved` re-opens.** Resolving means "I have corrected the data"; if the
 * contradiction is still there, the correction did not happen, and staying quiet
 * would turn the button into a way of hiding a fault. **`dismissed` never
 * re-opens** — that is the answer "this is not wrong", and it is the escape
 * hatch for a check that is right about the disagreement and wrong about the
 * conclusion. Two different answers, deliberately not one.
 *
 * ## Two runs at once
 *
 * The read above and the writes below are not one transaction, and they cannot
 * usefully be: the pass reads the whole account and can take seconds, so holding
 * a transaction open across it would be a lock on every import for the duration.
 * Two overlapping passes for one account therefore both see "no such flag" and
 * both try to create it — reachable in production, because a place import fires
 * the checks immediately while a lodging import fires them after geocoding.
 *
 * `@@unique([userId, entityType, entityId, kind])` keeps the storage correct.
 * What it does NOT do by itself is keep the run correct: the loser's `create`
 * throws P2002, and before `createOrAdopt` below existed that error left this
 * function and abandoned the loser's entire pass — every remaining check for
 * that account went unrun, over a collision the database had already handled.
 *
 * `services/dataQualityTrigger.ts` queues triggers per account, which removes
 * the common case. It is per PROCESS, so it cannot cover two containers against
 * one database, nor the nightly sweep meeting an import. The runner survives the
 * collision on its own; the queue is there for ordering, not for safety.
 */

/**
 * What one pass did. Under a collision, each counter reports only this pass's
 * own work — the row a concurrent pass wrote is never claimed by this one:
 *
 * - `opened` — rows THIS pass inserted. A create that lost to P2002 is not
 *   counted here, because the question was opened by the other pass. Two
 *   colliding passes therefore report one `opened` between them, not two.
 * - `reopened` / `updated` — a lost create falls through to the same transition
 *   table an already-existing flag gets, so it lands here when the adopted row
 *   was `resolved`, or was `open` with details this pass computed differently.
 *   The usual outcome is neither: both passes derived the same finding, so the
 *   details match and nothing is counted, exactly as a sequential second run
 *   reports nothing.
 * - `autoResolved` — unchanged, and deliberately blind to the other pass: it is
 *   derived from the flags this pass read at its start, so a flag created by the
 *   other pass after that read is not a candidate. It cannot be — this pass has
 *   no finding for it either way, and resolving a row it never saw would be
 *   guessing.
 */
export interface DataQualityRunSummary {
  opened: number;
  reopened: number;
  updated: number;
  /** Flags whose disagreement is gone — including ones whose record was deleted. */
  autoResolved: number;
  /** Open flags after the run. What the inbox will show. */
  open: number;
}

/** Every check, in one place, so adding one is a single line. */
export function collectFindings(
  snapshot: Awaited<ReturnType<typeof loadAccountSnapshot>>
): DataQualityFinding[] {
  return [
    ...findAddressCountryMismatches(snapshot.addressRecords),
    ...findUndatedCountryEvidence(snapshot.countryTouches),
    ...findReversedStayDates(snapshot.lodgingStays),
    ...findCoordinatesOutsideCountry(snapshot.locatedRecords, snapshot.countryLookup),
  ];
}

const asJson = (details: DataQualityFinding["details"]): Prisma.InputJsonValue =>
  details as unknown as Prisma.InputJsonValue;

/**
 * Serialise with object keys in a fixed order.
 *
 * `details` is a **jsonb** column, and jsonb does not keep the key order it was
 * given — it stores them sorted by length, then alphabetically. So a plain
 * `JSON.stringify` comparison of what came back against what was just computed
 * reports a difference on every single run, for every flag whose details happen
 * to have more than one key in an unlucky order.
 *
 * Measured on a throwaway database before this existed: a second run over four
 * unchanged flags reported `updated: 3`. Three pointless writes per run, and
 * the in-memory unit test could never have seen it, because a JS object DOES
 * keep insertion order. This is what "a test that cannot see the thing" looks
 * like — hence the note in the suite next door.
 */
const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

/**
 * A unique-constraint violation, and the only error this file expects.
 *
 * Checked structurally rather than with `instanceof
 * Prisma.PrismaClientKnownRequestError`: the client is generated into
 * `node_modules/.prisma`, and a second copy of that module — a worktree, a
 * hoisted duplicate — makes `instanceof` answer false for an error that is one.
 * A wrong answer here is a swallowed P2002 turning back into an abandoned pass,
 * which is the defect being fixed.
 *
 * The code alone is enough to identify WHICH index: a freshly created flag can
 * only violate the compound unique one, since `id` is a new uuid.
 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * Insert the flag, or — when a concurrent pass got there first — hand back the
 * row it wrote, so this pass can reconcile it instead of dying on it.
 *
 * **Why catch-and-adopt rather than `upsert`.** An upsert has to name its update
 * payload before it knows the row's status, and every transition in the table
 * above turns on exactly that: `dismissed` must not be touched, `resolved` must
 * be re-opened, `open` may only need its details refreshed. A fixed payload
 * would have to pick one — writing `status: "open"` resurrects a dismissal the
 * user has already answered ("this is not wrong, stop asking"), and writing
 * nothing leaves the pass unable to say what it did, so `opened` would count a
 * row it did not open. Adopting the row costs one extra `findUnique` on the rare
 * collision and keeps both properties.
 *
 * **Why this catch is narrow.** The house rule is that errors are not swallowed,
 * and this is the justified exception, not a relaxation of it: P2002 out of this
 * one `create` is a MEANINGFUL answer — "the row you wanted exists" — and the
 * caller acts on it rather than ignoring it. Every other error still propagates.
 */
async function createOrAdopt(
  userId: string,
  finding: DataQualityFinding
): Promise<{ created: true } | { created: false; row: DataQualityFlag | null }> {
  try {
    await prisma.dataQualityFlag.create({
      data: {
        userId,
        entityType: finding.entityType,
        entityId: finding.entityId,
        kind: finding.kind,
        status: "open",
        details: asJson(finding.details),
      },
    });
    return { created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const row = await prisma.dataQualityFlag.findUnique({
      where: {
        userId_entityType_entityId_kind: {
          userId,
          entityType: finding.entityType,
          entityId: finding.entityId,
          kind: finding.kind,
        },
      },
    });
    return { created: false, row };
  }
}

type ReconcileOutcome = "untouched" | "reopened" | "updated";

/**
 * The transition table applied to a flag that already exists.
 *
 * Shared by both ways of arriving at one — it was there when the pass started,
 * or a concurrent pass wrote it in between — because the answer depends on the
 * row's CURRENT status, never on when this pass first learned of it.
 */
async function reconcileExisting(
  current: DataQualityFlag,
  finding: DataQualityFinding
): Promise<ReconcileOutcome> {
  if (current.status === "dismissed") return "untouched";

  if (current.status === "resolved") {
    await prisma.dataQualityFlag.update({
      where: { id: current.id },
      data: { status: "open", resolvedAt: null, details: asJson(finding.details) },
    });
    return "reopened";
  }

  // Open. Only write when the details actually moved — an unchanged run
  // should cost nothing, because it will happen far more often than a
  // changed one.
  if (stableStringify(current.details) !== stableStringify(finding.details)) {
    await prisma.dataQualityFlag.update({
      where: { id: current.id },
      data: { details: asJson(finding.details) },
    });
    return "updated";
  }

  return "untouched";
}

export async function runDataQualityChecks(
  userId: string,
  now: Date = new Date()
): Promise<DataQualityRunSummary> {
  const snapshot = await loadAccountSnapshot(userId, now);
  const findings = collectFindings(snapshot);

  const existing = await prisma.dataQualityFlag.findMany({ where: { userId } });
  const byKey = new Map(existing.map((flag) => [findingKey(flag), flag]));

  const summary: DataQualityRunSummary = {
    opened: 0,
    reopened: 0,
    updated: 0,
    autoResolved: 0,
    open: 0,
  };

  const seen = new Set<string>();

  for (const finding of findings) {
    const key = findingKey(finding);
    seen.add(key);
    let current = byKey.get(key) ?? null;

    if (!current) {
      const attempt = await createOrAdopt(userId, finding);
      if (attempt.created) {
        summary.opened += 1;
        continue;
      }
      if (!attempt.row) {
        // P2002 said the row was there and it was gone a moment later — only
        // reachable if the account itself was being deleted mid-pass. One
        // unasked question and a log line, never an abandoned pass: the
        // remaining checks for this account still have to run.
        logger.warn(
          {
            operation: "data_quality_flag_vanished_after_conflict",
            userId,
            entityType: finding.entityType,
            entityId: finding.entityId,
            kind: finding.kind,
          },
          "Data-quality flag could not be written: a concurrent run created it and it no longer exists"
        );
        continue;
      }
      // Adopt what the other pass wrote and reconcile it as if it had been
      // there all along. Notably NOT counted as `opened` — that pass opened it.
      current = attempt.row;
    }

    const outcome = await reconcileExisting(current, finding);
    if (outcome === "reopened") summary.reopened += 1;
    else if (outcome === "updated") summary.updated += 1;
  }

  const stale = existing.filter((flag) => flag.status === "open" && !seen.has(findingKey(flag)));
  if (stale.length > 0) {
    await prisma.dataQualityFlag.updateMany({
      where: { id: { in: stale.map((flag) => flag.id) } },
      data: { status: "resolved", resolvedAt: now },
    });
    summary.autoResolved = stale.length;
  }

  summary.open = await prisma.dataQualityFlag.count({ where: { userId, status: "open" } });
  return summary;
}
