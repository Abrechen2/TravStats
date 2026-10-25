/**
 * The accept protocol of `location_suggestions` (TravTrack plan E4, review
 * focus 21), in the form E7's journey questions need. Three committed steps:
 *
 *   1. CLAIM, its own statement (`UPDATE … RETURNING`): a `pending` row, or an
 *      `accepting` one whose claim is older than `CLAIM_STALE_MS` (a crash
 *      between the steps), gets a fresh token and is answered AS CLAIMED. A
 *      fresh claim of someone else answers 409 `SUGGESTION_ACCEPT_IN_PROGRESS`
 *      — two clicks never write twice — anything else 409
 *      `SUGGESTION_ALREADY_RESOLVED`, unless the kind recognises the request
 *      as a repeat of an answer already given (`replay`): then that answer.
 *      TravTrack off answers 403 `TRAVTRACK_DISABLED`, an account no longer on
 *      provider `travtrack` 409 `TRAVTRACK_UNAVAILABLE`, both before claiming.
 *   2. RE-CHECK by the kind's own rule, holding no transaction; it captures
 *      the history generation BEFORE it reads.
 *   3. PUBLISH under the TravTrack lock: the row must still carry this claim
 *      and the generation must be the captured one, else step 2 runs once
 *      more and then 409 `HISTORY_CHANGED` hands the question back open.
 *      Availability is asked again inside the transaction. `holds` applies
 *      the answer; `invalidated` writes the kind's invalidation, COMMITS, and
 *      only then answers 409 `EVIDENCE_INVALIDATED`; `unverifiable` hands the
 *      question back open with 409 `EVIDENCE_UNVERIFIABLE`.
 *
 * Unlike a country question, answering a journey RUN may leave the question
 * open (other runs still unanswered), so the kind's `apply` names the row's
 * next state instead of the protocol marking it accepted.
 *
 * Merge note: E4/E6 (`locationEvidence/acceptFlow.ts`, other branches) hold
 * the shared protocol. This file is the same protocol behind the
 * `SuggestionAcceptKind` adapter; folding it in means letting the shared
 * `apply` return the row's next state — the journey adapter (`accept.ts`)
 * then plugs in unchanged.
 */
import { randomUUID } from "crypto";

import { prisma, type DbTransaction } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import type { Prisma } from "../../../prisma";
import logger from "../../../utils/logger";
import { takeTravTrackLock } from "../../travtrack/lock";
import { assertTravTrackDerivationAllowed } from "../allowed";
import { historyGeneration } from "../generation";

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

export type StoredSuggestion = Prisma.LocationSuggestionGetPayload<{
  select: typeof SUGGESTION_SELECT;
}>;

export type Recheck = { outcome: "holds" | "invalidated" | "unverifiable"; generation: bigint };

/** The fields a publication writes; the protocol clears the claim itself. */
export type SuggestionUpdate = {
  status: "pending" | "accepted" | "rejected" | "invalidated";
  evidence: Prisma.InputJsonValue;
  acceptedEntryKind?: string | null;
  acceptedEntryId?: string | null;
};

export type SuggestionAcceptKind = {
  /** The request repeats an answer the row holds: answer it, no re-check (rule 6). */
  replay(row: StoredSuggestion): boolean;
  /** Refuses a request the row can never take (throws); runs before claiming and on the claim. */
  validate(row: StoredSuggestion, db: DbTransaction): Promise<void>;
  recheck(row: StoredSuggestion): Promise<Recheck>;
  apply(tx: DbTransaction, row: StoredSuggestion): Promise<SuggestionUpdate>;
  invalidate(row: StoredSuggestion): SuggestionUpdate;
};

export type AcceptHooks = {
  /** Test seam: after each re-check, before its publication. */
  afterRecheck?: () => Promise<unknown>;
};

export const notFound = () => new AppError("Suggestion not found", 404);
export const resolved = () =>
  new AppError("This suggestion was answered already", 409, "SUGGESTION_ALREADY_RESOLVED");
export const inProgress = () =>
  new AppError(
    "This suggestion is being accepted; try again",
    409,
    "SUGGESTION_ACCEPT_IN_PROGRESS"
  );
const invalidated = () =>
  new AppError(
    "The history behind this suggestion no longer holds it",
    409,
    "EVIDENCE_INVALIDATED"
  );
const historyChanged = () =>
  new AppError(
    "The location history kept changing while this was accepted; try again",
    409,
    "HISTORY_CHANGED"
  );
const unverifiable = () =>
  new AppError(
    "The history behind this suggestion cannot be checked right now",
    409,
    "EVIDENCE_UNVERIFIABLE"
  );

export async function loadSuggestion(userId: string, id: string): Promise<StoredSuggestion> {
  const row = await prisma.locationSuggestion.findFirst({
    where: { id, userId },
    select: SUGGESTION_SELECT,
  });
  if (!row) throw notFound();
  return row;
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
  explanation: Prisma.JsonValue;
  evidence: Prisma.JsonValue;
  accepted_entry_kind: string | null;
  accepted_entry_id: string | null;
};

/** Claims the row and answers it as claimed, in one statement. */
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

/** Hands a claimed row back open, untouched. */
async function release(id: string, token: string): Promise<void> {
  await prisma.locationSuggestion.updateMany({
    where: { id, status: "accepting", claimToken: token },
    data: { status: "pending", claimToken: null, claimedAt: null },
  });
}

/** Why a claim was refused, read from the row as it is now; a repeat is answered. */
async function refusal(
  userId: string,
  id: string,
  kind: SuggestionAcceptKind
): Promise<StoredSuggestion> {
  const row = await loadSuggestion(userId, id);
  if (kind.replay(row)) return row;
  throw row.status === "accepting" ? inProgress() : resolved();
}

type Published = { row: StoredSuggestion } | { invalidated: true } | { retry: true };

async function publish(
  row: StoredSuggestion,
  token: string,
  check: Recheck,
  kind: SuggestionAcceptKind
): Promise<Published> {
  return prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, row.userId);
    const still = await tx.locationSuggestion.findFirst({
      where: { id: row.id, status: "accepting", claimToken: token },
      select: { id: true },
    });
    if (!still) throw inProgress();
    if ((await historyGeneration(tx, row.userId)) !== check.generation) return { retry: true };
    // Asked again under the lock: a switch during the re-check writes nothing.
    await assertTravTrackDerivationAllowed(row.userId);
    const update = check.outcome === "holds" ? await kind.apply(tx, row) : kind.invalidate(row);
    const final = update.status !== "pending";
    const written = await tx.locationSuggestion.update({
      where: { id: row.id },
      data: { ...update, claimToken: null, claimedAt: null, resolvedAt: final ? new Date() : null },
      select: SUGGESTION_SELECT,
    });
    return check.outcome === "holds" ? { row: written } : { invalidated: true };
  });
}

export async function runAcceptProtocol(
  userId: string,
  id: string,
  kind: SuggestionAcceptKind,
  hooks: AcceptHooks = {}
): Promise<StoredSuggestion> {
  const loaded = await loadSuggestion(userId, id);
  if (kind.replay(loaded)) return loaded;
  if (loaded.provider === "travtrack") await assertTravTrackDerivationAllowed(userId);
  await kind.validate(loaded, prisma);

  const token = randomUUID();
  const row = await claim(userId, id, token);
  if (!row) return refusal(userId, id, kind);

  try {
    // The claim may have read a row that changed since the first read.
    if (kind.replay(row)) {
      await release(id, token);
      return row;
    }
    await kind.validate(row, prisma);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const check = await kind.recheck(row);
      await hooks.afterRecheck?.();
      if (check.outcome === "unverifiable") throw unverifiable();
      const published = await publish(row, token, check, kind);
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
  throw historyChanged();
}
