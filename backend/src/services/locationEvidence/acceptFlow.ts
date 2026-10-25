/**
 * Accepting a location suggestion — a committed protocol of three steps
 * (TravTrack plan E4, built here for the rows of `location_suggestions` that
 * E6 creates; review focus 21). E4 extends it to TravTrack stay findings.
 *
 *   1. CLAIM, its own committed transaction. An accepted row is a REPLAY: the
 *      stored entry is answered and nothing is re-checked (an accepted answer
 *      survives a later deletion, rule 6). A pending row, or one whose claim is
 *      older than `CLAIM_STALE_MS` (a crash between the steps), is claimed with
 *      a fresh token. A fresh claim of someone else answers 409
 *      `SUGGESTION_ACCEPT_IN_PROGRESS` — two clicks never write twice —
 *      anything else 409 `SUGGESTION_ALREADY_RESOLVED`. TravTrack switched off
 *      answers 403 `TRAVTRACK_DISABLED` before claiming.
 *   2. RE-CHECK by the kind's own rule, holding no transaction, after
 *      capturing the history generation.
 *   3. PUBLISH under the TravTrack lock: the row must still carry this claim
 *      and the generation must be the captured one, else step 2 runs once
 *      more. `holds` applies the entry and marks the row accepted;
 *      `invalidated` marks the row invalidated, COMMITS, and only then answers
 *      409 `EVIDENCE_INVALIDATED` — a client that never sees the answer finds
 *      the row invalidated on its next read.
 *
 * Rejecting writes nothing but the answer and works with TravTrack off.
 */
import { randomUUID } from "crypto";

import { prisma, type DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { travTrackInstanceOn } from "../travtrack/availability";
import { takeTravTrackLock } from "../travtrack/lock";
import { historyGeneration } from "./generation";

/** A claim older than this is a crashed accept and may be taken over. */
export const CLAIM_STALE_MS = 2 * 60_000;

export const SUGGESTION_SELECT = {
  id: true,
  userId: true,
  kind: true,
  provider: true,
  providerRev: true,
  algorithm: true,
  windowFrom: true,
  windowUntil: true,
  status: true,
  explanation: true,
  evidence: true,
  acceptedEntryKind: true,
  acceptedEntryId: true,
} as const;

export type StoredSuggestion = {
  id: string;
  userId: string;
  kind: string;
  provider: string;
  providerRev: number;
  algorithm: number;
  windowFrom: Date;
  windowUntil: Date;
  status: string;
  explanation: unknown;
  evidence: unknown;
  acceptedEntryKind: string | null;
  acceptedEntryId: string | null;
};

export type AcceptKind = {
  recheck: (row: StoredSuggestion) => Promise<"holds" | "invalidated">;
  /** Writes (or finds) the entry the answer makes, inside the publication's transaction. */
  apply: (tx: DbTransaction, row: StoredSuggestion) => Promise<{ kind: string; id: string }>;
};

const resolved = () =>
  new AppError("This suggestion was answered already", 409, "SUGGESTION_ALREADY_RESOLVED");
const inProgress = () =>
  new AppError(
    "This suggestion is being accepted; try again",
    409,
    "SUGGESTION_ACCEPT_IN_PROGRESS"
  );
const invalidated = () =>
  new AppError(
    "The history behind this suggestion changed or was deleted",
    409,
    "EVIDENCE_INVALIDATED"
  );

async function load(userId: string, id: string): Promise<StoredSuggestion> {
  const row = await prisma.locationSuggestion.findFirst({
    where: { id, userId },
    select: SUGGESTION_SELECT,
  });
  if (!row) throw new AppError("Suggestion not found", 404);
  return row;
}

const claimable = (now: number) => ({
  OR: [
    { status: "pending" },
    { status: "accepting", claimedAt: { lt: new Date(now - CLAIM_STALE_MS) } },
  ],
});

/** Why a claim was refused, read from the row as it is now. */
async function refusal(userId: string, id: string): Promise<StoredSuggestion> {
  const row = await load(userId, id);
  if (row.status === "accepted") return row;
  throw row.status === "accepting" ? inProgress() : resolved();
}

async function release(id: string, token: string): Promise<void> {
  await prisma.locationSuggestion.updateMany({
    where: { id, status: "accepting", claimToken: token },
    data: { status: "pending", claimToken: null, claimedAt: null },
  });
}

type Published = { row: StoredSuggestion } | { invalidated: true } | { retry: true };

async function publish(
  row: StoredSuggestion,
  token: string,
  generation: bigint,
  outcome: "holds" | "invalidated",
  kind: AcceptKind
): Promise<Published> {
  return prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, row.userId);
    const still = await tx.locationSuggestion.findFirst({
      where: { id: row.id, status: "accepting", claimToken: token },
      select: { id: true },
    });
    if (!still) throw inProgress();
    if ((await historyGeneration(tx, row.userId)) !== generation) return { retry: true };
    const done = { claimToken: null, claimedAt: null, resolvedAt: new Date() };
    if (outcome === "invalidated") {
      await tx.locationSuggestion.update({
        where: { id: row.id },
        data: { ...done, status: "invalidated" },
      });
      return { invalidated: true };
    }
    const entry = await kind.apply(tx, row);
    const accepted = await tx.locationSuggestion.update({
      where: { id: row.id },
      data: {
        ...done,
        status: "accepted",
        acceptedEntryKind: entry.kind,
        acceptedEntryId: entry.id,
      },
      select: SUGGESTION_SELECT,
    });
    return { row: accepted };
  });
}

export async function acceptFlow(
  userId: string,
  id: string,
  kind: AcceptKind
): Promise<StoredSuggestion> {
  const row = await load(userId, id);
  if (row.status === "accepted") return row;
  if (row.provider === "travtrack" && !(await travTrackInstanceOn())) {
    throw new AppError("TravTrack is switched off on this server", 403, "TRAVTRACK_DISABLED");
  }

  const token = randomUUID();
  const { count } = await prisma.locationSuggestion.updateMany({
    where: { id, userId, ...claimable(Date.now()) },
    data: { status: "accepting", claimToken: token, claimedAt: new Date() },
  });
  if (count === 0) return refusal(userId, id);

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const generation = await prisma.$transaction((tx) => historyGeneration(tx, userId));
      const outcome = await kind.recheck(row);
      const published = await publish(row, token, generation, outcome, kind);
      if ("row" in published) return published.row;
      if ("invalidated" in published) {
        // Committed above; the answer leaves only now. Ids and counts only.
        logger.info({ operation: "EvidenceInvalidated", id, userId, reason: "recheck" });
        throw invalidated();
      }
    }
  } catch (error) {
    await release(id, token);
    throw error;
  }
  // The history moved under both re-checks: hand the question back untouched.
  await release(id, token);
  throw invalidated();
}

export async function rejectSuggestion(userId: string, id: string): Promise<StoredSuggestion> {
  await load(userId, id);
  const { count } = await prisma.locationSuggestion.updateMany({
    where: { id, userId, ...claimable(Date.now()) },
    data: { status: "rejected", claimToken: null, claimedAt: null, resolvedAt: new Date() },
  });
  const row = await load(userId, id);
  if (count === 0 && row.status !== "rejected") {
    throw row.status === "accepting" ? inProgress() : resolved();
  }
  return row;
}
