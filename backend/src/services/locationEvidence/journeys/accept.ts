/**
 * Answering a journey question (TravTrack plan E7): one run at a time.
 *
 * ACCEPT links a run to the entry the user made for it through a TravStats
 * form — a rail ride, a bus ride or a roadtrip. TravTrack never writes the
 * entry (rule 6); the server checks that it exists, is the user's and holds at
 * least half the run (else 400 `VALIDATION_FAILED`: the saved entry stays, the
 * run stays open), re-checks the run against the history as it is now (the
 * run is still found: `movementRuns` over its window yields one overlapping
 * it by `RECHECK_SHARE`) and publishes the link through the accept protocol.
 * The same entry again answers the same; another entry on a linked run is 409
 * `SUGGESTION_ALREADY_RESOLVED`. The question is `accepted` once every run is
 * answered and one of them linked; it names its first linked entry.
 *
 * CLOSE (`/reject`) says a run — or every open run — needs no entry. It
 * writes nothing but the answer and works with TravTrack off. Every run
 * closed is `rejected`; a run linked among them makes it `accepted`.
 *
 * A run whose history no longer holds it is `invalidated` (committed before
 * the 409); the question is `invalidated` when that leaves nothing linked.
 */
import { prisma, type DbTransaction } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import type { Prisma } from "../../../prisma";
import { privacyCirclesFor } from "../../travtrack/privacyCircles";
import { readTravTrackDerivation } from "../derivationRead";
import { ENTRY_WINDOW_ADAPTERS, overlapShare, COVER_SHARE } from "./entryWindows";
import {
  allAnswered,
  parseJourneyEvidence,
  type JourneyEntryKind,
  type JourneyEvidence,
  type RunState,
} from "./evidence";
import {
  inProgress,
  loadSuggestion,
  resolved,
  runAcceptProtocol,
  CLAIM_STALE_MS,
  SUGGESTION_SELECT,
  type AcceptHooks,
  type StoredSuggestion,
  type SuggestionAcceptKind,
  type SuggestionUpdate,
} from "./acceptProtocol";
import { JOURNEY_GAP_MS, movementRuns } from "./segment";

/** A run still holds when a run found now covers this share of it. */
export const RECHECK_SHARE = 0.8;
/**
 * Read around the run when re-checking: enough for the stay before and after
 * it, and for the silence a run out of (or into) a zone begins with — a run
 * bounded by silence must see more than `JOURNEY_GAP_MS` of it.
 */
export const RECHECK_MARGIN_MS = 2 * JOURNEY_GAP_MS;

export type JourneyAnswer = { runIndex: number; entryKind: JourneyEntryKind; entryId: string };

const invalidInput = (message: string, field: string) =>
  new AppError(message, 400, "VALIDATION_FAILED", field);

function journeyOf(row: StoredSuggestion): JourneyEvidence {
  if (row.kind !== "journey") throw invalidInput("Not a journey question", "id");
  const evidence = parseJourneyEvidence(row.evidence);
  // A row this build cannot read was written by a newer one: it is not ours to answer.
  if (!evidence) throw resolved();
  return evidence;
}

/** The question's state once its runs read as they do in `evidence`. */
function settle(evidence: JourneyEvidence): SuggestionUpdate {
  const linked = evidence.runs.find((r) => r.link);
  const status: SuggestionUpdate["status"] = !allAnswered(evidence)
    ? "pending"
    : linked
      ? "accepted"
      : evidence.runs.some((r) => r.state === "closed")
        ? "rejected"
        : "invalidated";
  return {
    status,
    evidence: evidence as unknown as Prisma.InputJsonValue,
    acceptedEntryKind: status === "accepted" ? (linked?.link?.entryKind ?? null) : null,
    acceptedEntryId: status === "accepted" ? (linked?.link?.entryId ?? null) : null,
  };
}

const withRun = (
  evidence: JourneyEvidence,
  index: number,
  state: RunState,
  link: JourneyEvidence["runs"][number]["link"]
): JourneyEvidence => ({
  ...evidence,
  runs: evidence.runs.map((r, i) => (i === index ? { ...r, state, link } : r)),
});

/** The entry's window, read through its own domain's adapter, or null when there is none. */
async function entryWindow(
  db: DbTransaction,
  userId: string,
  answer: JourneyAnswer,
  run: { fromMs: number; untilMs: number }
) {
  const adapter = ENTRY_WINDOW_ADAPTERS[answer.entryKind];
  if ("none" in adapter) return null;
  const around = { fromMs: run.fromMs - 86_400_000, untilMs: run.untilMs + 86_400_000 };
  const windows = await adapter.read(userId, around, db);
  return windows.find((w) => w.id === answer.entryId) ?? null;
}

/** The accept protocol's adapter for one run of a journey question. */
export function journeyAcceptKind(answer: JourneyAnswer): SuggestionAcceptKind {
  const runOf = (row: StoredSuggestion) => {
    const evidence = journeyOf(row);
    const run = evidence.runs[answer.runIndex];
    if (!run) throw invalidInput("No such run in this question", "runIndex");
    return { evidence, run };
  };
  const validate = async (row: StoredSuggestion, db: DbTransaction): Promise<void> => {
    const { run } = runOf(row);
    const w = await entryWindow(db, row.userId, answer, run);
    if (!w || overlapShare(run, w) < COVER_SHARE) {
      throw invalidInput(
        "The entry is not this account's or does not hold half of the journey",
        "entryId"
      );
    }
  };
  return {
    replay(row) {
      const { run } = runOf(row);
      if (run.state === "open") return false;
      if (
        run.state === "linked" &&
        run.link?.entryKind === answer.entryKind &&
        run.link.entryId === answer.entryId
      ) {
        return true;
      }
      throw resolved();
    },
    validate,
    async recheck(row) {
      const { run } = runOf(row);
      const window = {
        fromMs: run.fromMs - RECHECK_MARGIN_MS,
        untilMs: run.untilMs + RECHECK_MARGIN_MS,
      };
      const read = await readTravTrackDerivation(row.userId, window);
      if (read.coverage !== "complete")
        return { outcome: "unverifiable", generation: read.generation };
      const circles = await privacyCirclesFor(row.userId, window.fromMs);
      const now = movementRuns(read.points, {
        readFromMs: window.fromMs,
        readUntilMs: window.untilMs,
        circles,
      });
      const holds = now.some((candidate) => overlapShare(run, candidate) >= RECHECK_SHARE);
      return { outcome: holds ? "holds" : "invalidated", generation: read.generation };
    },
    async apply(tx, row) {
      // Validated again inside the publication: the entry may have gone meanwhile.
      await validate(row, tx);
      const { evidence } = runOf(row);
      const link = { entryKind: answer.entryKind, entryId: answer.entryId };
      return settle(withRun(evidence, answer.runIndex, "linked", link));
    },
    invalidate(row) {
      const { evidence } = runOf(row);
      return settle(withRun(evidence, answer.runIndex, "invalidated", null));
    },
  };
}

export async function acceptJourneyRun(
  userId: string,
  id: string,
  answer: JourneyAnswer,
  hooks: AcceptHooks = {}
): Promise<StoredSuggestion> {
  return runAcceptProtocol(userId, id, journeyAcceptKind(answer), hooks);
}

/** An accept holds this row right now: a claim younger than `CLAIM_STALE_MS`. */
async function freshlyClaimed(id: string): Promise<boolean> {
  const row = await prisma.locationSuggestion.findFirst({
    where: { id, status: "accepting", claimedAt: { gte: new Date(Date.now() - CLAIM_STALE_MS) } },
    select: { id: true },
  });
  return row !== null;
}

/** Nothing left to close: a repeat answers the row; anything else was answered otherwise. */
function closedAlready(row: StoredSuggestion, evidence: JourneyEvidence, runIndex?: number) {
  if (runIndex !== undefined) {
    if (evidence.runs[runIndex].state === "closed") return row;
    throw resolved();
  }
  if (row.status === "rejected") return row;
  throw resolved();
}

/**
 * Close one run, or every open run, of a journey question. Optimistic: the
 * write lands only on the row as it was read (status and evidence), so an
 * accept publishing meanwhile is never overwritten; the second try reads it.
 * A claim left by a crash does not block it; a live one does.
 */
export async function closeJourneyRuns(
  userId: string,
  id: string,
  runIndex?: number
): Promise<StoredSuggestion> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = await loadSuggestion(userId, id);
    const evidence = journeyOf(row);
    if (runIndex !== undefined && !evidence.runs[runIndex]) {
      throw invalidInput("No such run in this question", "runIndex");
    }
    if (await freshlyClaimed(id)) throw inProgress();
    const targets = runIndex === undefined ? evidence.runs.map((_, i) => i) : [runIndex];
    const open = targets.filter((i) => evidence.runs[i].state === "open");
    if (open.length === 0) return closedAlready(row, evidence, runIndex);
    if (row.status !== "pending" && row.status !== "accepting") throw resolved();
    const next = open.reduce((e, i) => withRun(e, i, "closed", null), evidence);
    const update = settle(next);
    const { count } = await prisma.locationSuggestion.updateMany({
      where: {
        id,
        userId,
        status: row.status,
        evidence: { equals: row.evidence as Prisma.InputJsonValue },
      },
      data: {
        ...update,
        claimToken: null,
        claimedAt: null,
        resolvedAt: update.status === "pending" ? null : new Date(),
      },
    });
    if (count === 1) {
      return prisma.locationSuggestion.findUniqueOrThrow({
        where: { id },
        select: SUGGESTION_SELECT,
      });
    }
  }
  throw inProgress();
}
