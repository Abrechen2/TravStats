/**
 * `location_suggestions` as the accept protocol (`acceptFlow.ts`) claims,
 * re-checks and publishes it — the store every kind of that table shares
 * (country, E6; journey, E7). A kind brings its re-check and the row's next
 * state its answer makes (`SuggestionKind`); writing that state, under the
 * claim token, is the store's. A country answer closes its question; a
 * journey answer links one run, and the question stays open while other runs
 * wait — so `apply` names the next status rather than the store assuming
 * `accepted`.
 *
 * The gate is the owner rule of 2026-10-25 (`allowed.ts`): a TravTrack
 * question is answered only while the instance's TravTrack is on AND the
 * account's provider is `travtrack` — 403 `TRAVTRACK_DISABLED` / 409
 * `TRAVTRACK_UNAVAILABLE`, asked before the claim and again inside the
 * publication.
 *
 * Rejecting writes nothing but the answer and works with TravTrack off.
 */
import { prisma, type DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { Prisma } from "../../prisma";
import { acceptFlow, CLAIM_STALE_MS, type AcceptHooks, type ClaimStore } from "./acceptFlow";
import { assertTravTrackDerivationAllowed } from "./allowed";
import { historyGeneration } from "./generation";
import type { Recheck } from "./recheck";

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

/** The fields a publication writes; the store clears the claim itself. */
export type SuggestionUpdate = {
  status: "pending" | "accepted" | "rejected" | "invalidated";
  evidence?: Prisma.InputJsonValue;
  explanation?: Prisma.InputJsonValue;
  acceptedEntryKind?: string | null;
  acceptedEntryId?: string | null;
};

type Outcome = Recheck["outcome"];

export type SuggestionKind = {
  /**
   * The kind's own rule against the history as it is now. A bare outcome is
   * fenced by the generation the store captured before the rule ran; a kind
   * that reads through `readTravTrackDerivation` may hand back that read's own
   * (equally early) generation.
   */
  recheck: (row: StoredSuggestion) => Promise<Outcome | Recheck>;
  /**
   * The row's next state when the evidence holds, inside the publication's
   * transaction — writing (or finding) the entry the answer makes first.
   */
  apply: (tx: DbTransaction, row: StoredSuggestion) => Promise<SuggestionUpdate>;
  /** The row's state when the evidence no longer holds. Default: `invalidated`. */
  invalidate?: (row: StoredSuggestion) => SuggestionUpdate;
  /** See `ClaimStore.isReplay`. Default: the row is `accepted`. */
  isReplay?: (row: StoredSuggestion) => boolean;
  /** Refuses a request the row can never take, before the claim and on the claimed row. */
  validate?: (row: StoredSuggestion, db: DbTransaction) => Promise<void>;
};

export const resolved = () =>
  new AppError("This suggestion was answered already", 409, "SUGGESTION_ALREADY_RESOLVED");
export const inProgress = () =>
  new AppError(
    "This suggestion is being accepted; try again",
    409,
    "SUGGESTION_ACCEPT_IN_PROGRESS"
  );

const find = (userId: string, id: string) =>
  prisma.locationSuggestion.findFirst({ where: { id, userId }, select: SUGGESTION_SELECT });

/** The account's row, or 404 `SUGGESTION_NOT_FOUND` (every row here is TravTrack's). */
export async function loadSuggestion(userId: string, id: string): Promise<StoredSuggestion> {
  const row = await find(userId, id);
  if (!row) throw new AppError("Suggestion not found", 404, "SUGGESTION_NOT_FOUND");
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
  explanation: unknown;
  evidence: unknown;
  accepted_entry_kind: string | null;
  accepted_entry_id: string | null;
};

const fromClaimed = (row: ClaimedRow): StoredSuggestion => ({
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
});

const gate = async (row: StoredSuggestion) => {
  if (row.provider === "travtrack") await assertTravTrackDerivationAllowed(row.userId);
};

/** Written under the claim only; the claim cleared, `resolvedAt` set once the question is closed. */
async function writeUnderClaim(
  tx: DbTransaction,
  userId: string,
  id: string,
  token: string,
  update: SuggestionUpdate
): Promise<number> {
  const { count } = await tx.locationSuggestion.updateMany({
    where: { id, userId, status: "accepting", claimToken: token },
    data: {
      ...update,
      claimToken: null,
      claimedAt: null,
      resolvedAt: update.status === "pending" ? null : new Date(),
    },
  });
  return count;
}

function suggestionStore(
  userId: string,
  kind: SuggestionKind
): ClaimStore<StoredSuggestion, StoredSuggestion> {
  return {
    isReplay: kind.isReplay,
    resolvedCode: "SUGGESTION_ALREADY_RESOLVED",
    find: (id) => find(userId, id),
    assertAllowed: gate,
    assertAllowedIn: (_tx, row) => gate(row),
    /**
     * Claims the row and answers it AS CLAIMED, in one statement (Codex review
     * of E6): a run that grew between the first read and the claim is
     * re-checked and applied as it now stands. A claimed row no longer grows
     * (`countrySuggestions` updates pending rows only).
     */
    async claim(id, token, staleBefore) {
      const [row] = await prisma.$queryRaw<ClaimedRow[]>`
        UPDATE location_suggestions
           SET status = 'accepting', claim_token = ${token}, claimed_at = now()
         WHERE id = ${id} AND user_id = ${userId}
           AND (status = 'pending' OR (status = 'accepting' AND claimed_at < ${staleBefore}))
        RETURNING id, user_id, kind, provider, provider_rev, algorithm, window_from, window_until,
                  status, explanation, evidence, accepted_entry_kind, accepted_entry_id`;
      return row ? fromClaimed(row) : null;
    },
    async holdsClaim(tx, id, token) {
      const [row] = await tx.$queryRaw<{ status: string; claim_token: string | null }[]>`
        SELECT status, claim_token FROM location_suggestions
         WHERE id = ${id} AND user_id = ${userId}
        FOR UPDATE`;
      if (!row) return "gone";
      return row.status === "accepting" && row.claim_token === token ? "held" : "lost";
    },
    async invalidate(tx, row, token) {
      await writeUnderClaim(
        tx,
        userId,
        row.id,
        token,
        kind.invalidate?.(row) ?? { status: "invalidated" }
      );
    },
    async release(id, token) {
      await prisma.locationSuggestion.updateMany({
        where: { id, userId, status: "accepting", claimToken: token },
        data: { status: "pending", claimToken: null, claimedAt: null },
      });
    },
    replay: (row) => row,
  };
}

/** Accepts a `location_suggestions` row of the given kind through the protocol. */
export async function acceptSuggestion(
  userId: string,
  id: string,
  kind: SuggestionKind,
  hooks: AcceptHooks = {}
): Promise<StoredSuggestion> {
  const validate = kind.validate;
  return acceptFlow({
    userId,
    id,
    store: suggestionStore(userId, kind),
    hooks,
    validate: validate ? (row) => validate(row, prisma) : undefined,
    // The generation is captured BEFORE the rule reads (E5's fence).
    recheck: async (row) => {
      const generation = await prisma.$transaction((tx) => historyGeneration(tx, userId));
      const checked = await kind.recheck(row);
      return typeof checked === "string" ? { outcome: checked, generation } : checked;
    },
    apply: async (tx, row, token) => {
      const update = await kind.apply(tx, row);
      // Row-locked by `holdsClaim` in this transaction: a miss is a bug, not a race.
      if ((await writeUnderClaim(tx, userId, row.id, token, update)) !== 1) throw inProgress();
      return tx.locationSuggestion.findUniqueOrThrow({
        where: { id: row.id },
        select: SUGGESTION_SELECT,
      });
    },
  });
}

const claimable = (now: number) => ({
  OR: [
    { status: "pending" },
    { status: "accepting", claimedAt: { lt: new Date(now - CLAIM_STALE_MS) } },
  ],
});

export async function rejectSuggestion(userId: string, id: string): Promise<StoredSuggestion> {
  await loadSuggestion(userId, id);
  const { count } = await prisma.locationSuggestion.updateMany({
    where: { id, userId, ...claimable(Date.now()) },
    data: { status: "rejected", claimToken: null, claimedAt: null, resolvedAt: new Date() },
  });
  const row = await loadSuggestion(userId, id);
  if (count === 0 && row.status !== "rejected") {
    throw row.status === "accepting" ? inProgress() : resolved();
  }
  return row;
}
