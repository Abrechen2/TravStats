/**
 * Accepting a location suggestion — a committed protocol of three steps
 * (TravTrack plan E4, built here for the rows of `location_suggestions` that
 * E6 creates; review focus 21). E4 extends it to TravTrack stay findings.
 *
 *   1. CLAIM, its own committed transaction. An accepted row is a REPLAY: the
 *      stored entry is answered and nothing is re-checked (an accepted answer
 *      survives a later deletion, rule 6). A pending row, or one whose claim is
 *      older than `CLAIM_STALE_MS` (a crash between the steps), is claimed with
 *      a fresh token — and returned as claimed, in the same statement, so the
 *      re-check and the entry use the window the row holds now. A fresh claim of someone else answers 409
 *      `SUGGESTION_ACCEPT_IN_PROGRESS` — two clicks never write twice —
 *      anything else 409 `SUGGESTION_ALREADY_RESOLVED`. TravTrack switched off
 *      answers 403 `TRAVTRACK_DISABLED`, an account no longer on provider
 *      `travtrack` 409 `TRAVTRACK_UNAVAILABLE`, both before claiming.
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
import { takeTravTrackLock } from "../travtrack/lock";
import { assertTravTrackDerivationAllowed } from "./allowed";
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
    // Asked again under the lock: a switch during the re-check writes nothing.
    if (row.provider === "travtrack") await assertTravTrackDerivationAllowed(row.userId);
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

type ClaimedRow = {
  id: string;
  user_id: string;
  kind: string;
  provider: string;
  provider_rev: number;
  algorithm: number;
  window_from: Date;
  window_until: Date;
  status: string;
  explanation: unknown;
  evidence: unknown;
  accepted_entry_kind: string | null;
  accepted_entry_id: string | null;
};

/**
 * Claims the row and answers it AS CLAIMED, in one statement: a run that grew
 * between the first read and the claim is re-checked and applied as it now
 * stands. A claimed row no longer grows (`countrySuggestions` updates pending
 * rows only), so this is the window the answer is about.
 */
async function claim(userId: string, id: string, token: string): Promise<StoredSuggestion | null> {
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS);
  const [row] = await prisma.$queryRaw<ClaimedRow[]>`
    UPDATE location_suggestions
       SET status = 'accepting', claim_token = ${token}, claimed_at = now()
     WHERE id = ${id} AND user_id = ${userId}
       AND (status = 'pending' OR (status = 'accepting' AND claimed_at < ${staleBefore}))
    RETURNING id, user_id, kind, provider, provider_rev, algorithm, window_from, window_until,
              status, explanation, evidence, accepted_entry_kind, accepted_entry_id`;
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    provider: row.provider,
    providerRev: row.provider_rev,
    algorithm: row.algorithm,
    windowFrom: row.window_from,
    windowUntil: row.window_until,
    status: row.status,
    explanation: row.explanation,
    evidence: row.evidence,
    acceptedEntryKind: row.accepted_entry_kind,
    acceptedEntryId: row.accepted_entry_id,
  };
}

export type AcceptHooks = {
  /** Test seam: runs after the first read, before the claim. */
  afterLoad?: () => Promise<void>;
};

export async function acceptFlow(
  userId: string,
  id: string,
  kind: AcceptKind,
  hooks: AcceptHooks = {}
): Promise<StoredSuggestion> {
  const loaded = await load(userId, id);
  if (loaded.status === "accepted") return loaded;
  if (loaded.provider === "travtrack") await assertTravTrackDerivationAllowed(userId);
  await hooks.afterLoad?.();

  const token = randomUUID();
  const row = await claim(userId, id, token);
  if (!row) return refusal(userId, id);

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
