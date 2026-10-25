/**
 * Accepting a TravTrack suggestion (TravTrack plan E4; review focus 20-23):
 * three committed steps, so that a double click, a lost answer, a crash or a
 * deletion in between never writes twice and never writes from deleted history.
 *
 * 1. Claim, in its own committed transaction. `accepted` → the replay: the
 *    stored entry, no re-check (an accepted stay survives a later deletion,
 *    rule 6). `pending`, or `accepting` with a claim older than
 *    `CLAIM_STALE_MS` (a crash between steps) → `accepting` with a fresh
 *    token. A fresh foreign claim → 409 `SUGGESTION_ACCEPT_IN_PROGRESS`.
 *    Anything else → 409 with the table's "already resolved" code. TravTrack
 *    off → 403 `TRAVTRACK_DISABLED` before anything is claimed.
 * 2. Re-check, holding no transaction (`recheck.ts`), capturing the history
 *    generation.
 * 3. Publish, in a transaction under the TravTrack lock: TravTrack still on,
 *    the claim still this one, the generation unchanged — otherwise the
 *    re-check runs once more, and then 409 `EVIDENCE_INVALIDATED`. Evidence
 *    that holds → `apply` writes the entry. Evidence that does not → the row
 *    is `invalidated` and committed, and only then the 409 goes out, so a
 *    client that never sees the answer finds the row invalidated.
 *
 * Any other failure after the claim (a missing trip, an invalid interval)
 * hands the claim back, so the finding is pending again.
 */
import crypto from "crypto";
import { prisma, type DbTransaction } from "../../db";
import { AppError, type ApiErrorCode } from "../../middleware/errorHandler";
import { Prisma } from "../../prisma";
import { travTrackInstanceOn, travTrackInstanceOnIn } from "../travtrack/availability";
import { takeTravTrackLock } from "../travtrack/lock";
import { takeStayAcceptLock } from "../dawarich/stays/acceptLock";
import logger from "../../utils/logger";
import { historyGeneration } from "./generation";
import type { Recheck } from "./recheck";

/** A claim older than this is a crash between the steps, and may be taken over. */
export const CLAIM_STALE_MS = 2 * 60_000;

export type ClaimState = {
  status: string;
  claimToken: string | null;
  claimedAt: Date | null;
};

/** The table a kind of suggestion lives in, as the protocol needs it. */
export interface ClaimStore<Row extends ClaimState, Entry> {
  /** The "already resolved" code the web reads for this table. */
  resolvedCode: ApiErrorCode;
  find(id: string): Promise<Row | null>;
  /** Take the claim if the row is `pending` or its claim is older than `staleBefore`. */
  claim(id: string, token: string, now: Date, staleBefore: Date): Promise<boolean>;
  /** Whether the row is still `accepting` under `token` (read inside `tx`). */
  holdsClaim(tx: DbTransaction, id: string, token: string): Promise<boolean>;
  invalidate(tx: DbTransaction, id: string, token: string): Promise<void>;
  /** Hand the claim back: `pending` again. */
  release(id: string, token: string): Promise<void>;
  /** The stored entry of an accepted row. */
  replay(row: Row): Entry;
}

const disabled = () =>
  new AppError("TravTrack is switched off on this server", 403, "TRAVTRACK_DISABLED");
const inProgress = () =>
  new AppError("This suggestion is being accepted", 409, "SUGGESTION_ACCEPT_IN_PROGRESS");
const invalidated = () =>
  new AppError("The evidence for this suggestion has changed", 409, "EVIDENCE_INVALIDATED");

async function claim<Row extends ClaimState, Entry>(
  id: string,
  store: ClaimStore<Row, Entry>
): Promise<{ token: string } | { replay: Entry }> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS);
  const row = await store.find(id);
  if (!row) throw new AppError("Finding not found", 404);
  if (row.status === "accepted") return { replay: store.replay(row) };
  const token = crypto.randomUUID();
  if (await store.claim(id, token, now, staleBefore)) return { token };
  // Lost the race, or not claimable: say which, from what the row is now.
  const current = (await store.find(id)) ?? row;
  if (current.status === "accepted") return { replay: store.replay(current) };
  if (current.status === "accepting") throw inProgress();
  throw new AppError("Finding already resolved", 409, store.resolvedCode);
}

type Published<Entry> = { entry: Entry } | { invalidated: true } | { moved: true };

async function publish<Row extends ClaimState, Entry>(
  userId: string,
  id: string,
  token: string,
  checked: Recheck,
  store: ClaimStore<Row, Entry>,
  apply: (tx: DbTransaction) => Promise<Entry>
): Promise<Published<Entry>> {
  // READ COMMITTED on purpose: every check below must see what committed
  // while this transaction waited for the locks. A serializable snapshot is
  // taken at the first statement — the lock request — and would read the
  // generation, the places and the visits as they were before the work it
  // waited behind. The stay-accept lock serializes this against every other
  // accept of the account, Dawarich's included (`acceptLock.ts`).
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx): Promise<Published<Entry>> => {
          await takeTravTrackLock(tx, userId);
          // Every stay accept of the account, Dawarich's too, one at a time.
          await takeStayAcceptLock(tx, userId);
          if (!(await travTrackInstanceOnIn(tx))) throw disabled();
          if (!(await store.holdsClaim(tx, id, token))) throw inProgress();
          if ((await historyGeneration(tx, userId)) !== checked.generation) return { moved: true };
          if (checked.outcome === "invalidated") {
            await store.invalidate(tx, id, token);
            return { invalidated: true };
          }
          return { entry: await apply(tx) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 }
      );
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034")
        throw error;
    }
  }
  throw inProgress();
}

export async function acceptFlow<Row extends ClaimState, Entry>(opts: {
  userId: string;
  id: string;
  store: ClaimStore<Row, Entry>;
  /** Step 2, against the row as claimed. */
  recheck: (row: Row) => Promise<Recheck>;
  /** Step 3's write when the evidence holds, inside the publication transaction. */
  apply: (tx: DbTransaction, row: Row, token: string) => Promise<Entry>;
}): Promise<Entry> {
  const { userId, id, store } = opts;
  if (!(await travTrackInstanceOn())) throw disabled();
  const claimed = await claim(id, store);
  if ("replay" in claimed) return claimed.replay;
  const { token } = claimed;
  let handedBack = false;
  try {
    for (let round = 0; round < 2; round++) {
      const row = await store.find(id);
      if (!row) throw new AppError("Finding not found", 404);
      const checked = await opts.recheck(row);
      const outcome = await publish(userId, id, token, checked, store, (tx) =>
        opts.apply(tx, row, token)
      );
      if ("entry" in outcome) return outcome.entry;
      if ("invalidated" in outcome) {
        handedBack = true;
        logger.info(
          { operation: "EvidenceInvalidated", userId, suggestionId: id },
          "Suggestion invalidated on accept: its evidence no longer holds"
        );
        throw invalidated();
      }
      // The history moved between re-check and publication: read it again.
    }
    throw invalidated();
  } catch (error) {
    if (!handedBack) await store.release(id, token);
    throw error;
  }
}
