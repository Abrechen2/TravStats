/**
 * Accepting a TravTrack suggestion — ONE committed protocol of three steps for
 * every kind (TravTrack plan E4; review focus 20-23). A double click, a lost
 * answer, a crash or a deletion in between never writes twice and never
 * writes from deleted history. The kinds plug in through a `ClaimStore` (the
 * table: `dawarich_stays` for stays, markets and venues — `review.ts`;
 * `location_suggestions` for countries and journeys — `suggestionStore.ts`)
 * and their own `recheck` / `apply`.
 *
 *   1. CLAIM, its own committed statement. An accepted row is a REPLAY: the
 *      stored entry is answered and nothing is re-checked (an accepted answer
 *      survives a later deletion, rule 6). The store's gate runs next —
 *      TravTrack off → 403 `TRAVTRACK_DISABLED`, an account no longer on
 *      TravTrack → 409 `TRAVTRACK_UNAVAILABLE` (where the kind asks it) —
 *      before anything is claimed. A `pending` row, or one whose claim is
 *      older than `CLAIM_STALE_MS` (a crash between the steps), is claimed
 *      with a fresh token and returned AS CLAIMED by the same statement, so
 *      the re-check and the entry use the window the row holds now. A fresh
 *      foreign claim → 409 `SUGGESTION_ACCEPT_IN_PROGRESS`; anything else →
 *      409 with the table's "already resolved" code.
 *   2. RE-CHECK by the kind's own rule, holding no transaction, capturing the
 *      history generation BEFORE it reads. `unverifiable` → 409
 *      `EVIDENCE_UNVERIFIABLE`, the claim is handed back.
 *   3. PUBLISH in one READ COMMITTED transaction under the locks below: the
 *      gate again, the row still claimed by this token (row-locked), the
 *      generation unchanged — the fence against a removal that landed after
 *      the re-check read (E5). A moved generation runs step 2 once more; if
 *      it moves again the claim is handed back with 409 `HISTORY_CHANGED`
 *      (nothing is invalidated without proof). Evidence that holds → `apply`
 *      writes the entry and the store marks the row accepted under the token.
 *      Evidence that does not → the row is `invalidated` and COMMITTED, and
 *      only then the 409 `EVIDENCE_INVALIDATED` goes out, so a client that
 *      never sees the answer finds the row invalidated. A row that a removal
 *      deleted meanwhile (E5: its history is gone) answers the same 409.
 *
 * Any other failure after the claim (a missing trip, an invalid interval)
 * hands the claim back, so the suggestion is pending again.
 *
 * LOCK ORDER (deadlock-free because every path takes a prefix of it, in it):
 *   (1) the account's TravTrack lock (`takeTravTrackLock`)
 *   (2) the kind's own advisory locks (`store.lock`; stays: the account's
 *       stay-accept lock, `acceptLock.ts`)
 *   (3) the suggestion's row (`holdsClaim`, `FOR UPDATE`) and the rows the
 *       entry writes.
 * Removals (E5), TravTrack scans and projections take (1) then rows; so does
 * the rejection of a TravTrack stay finding, which hands a venue's fragments
 * back as a removal does (`rejectStay`). The Dawarich stay accept takes (2)
 * then rows; the claim, the release and any other reject take only a row,
 * each in a statement of its own. Nothing takes (1) or (2) while holding a
 * row lock, so no cycle can form.
 */
import crypto from "crypto";
import { prisma, type DbTransaction } from "../../db";
import { AppError, type ApiErrorCode } from "../../middleware/errorHandler";
import { Prisma } from "../../prisma";
import { takeTravTrackLock } from "../travtrack/lock";
import logger from "../../utils/logger";
import { historyGeneration } from "./generation";
import type { Recheck } from "./recheck";

/** A claim older than this is a crash between the steps, and may be taken over. */
export const CLAIM_STALE_MS = 2 * 60_000;

export type ClaimState = {
  status: string;
  claimToken?: string | null;
  claimedAt?: Date | null;
};

/** The table a kind of suggestion lives in, as the protocol needs it. */
export interface ClaimStore<Row extends ClaimState, Entry> {
  /** The "already resolved" code the web reads for this table. */
  resolvedCode: ApiErrorCode;
  find(id: string): Promise<Row | null>;
  /** May TravStats act on this account's TravTrack history now? Throws the client's error. */
  assertAllowed(row: Row): Promise<void>;
  /** The same question inside the publication: a switch during the re-check writes nothing. */
  assertAllowedIn(tx: DbTransaction, row: Row): Promise<void>;
  /**
   * Take the claim — in ONE statement — if the row is `pending` or its claim
   * is older than `staleBefore`, and return the row as claimed; null when not
   * claimed.
   */
  claim(id: string, token: string, staleBefore: Date): Promise<Row | null>;
  /** Advisory locks of the kind, taken after the TravTrack lock (lock order (2)). */
  lock?(tx: DbTransaction): Promise<void>;
  /**
   * Whether the row is still `accepting` under `token`, row-locked until the
   * transaction ends (`FOR UPDATE`), so a stale takeover cannot slip in
   * between this check and the final write. `gone`: the row no longer exists.
   */
  holdsClaim(tx: DbTransaction, id: string, token: string): Promise<"held" | "lost" | "gone">;
  /** The evidence no longer holds: write the kind's invalidation under the claim. */
  invalidate(tx: DbTransaction, row: Row, token: string): Promise<void>;
  /** Hand the claim back: `pending` again. */
  release(id: string, token: string): Promise<void>;
  /** The stored entry of an accepted row. */
  replay(row: Row): Entry;
  /**
   * Whether this request repeats an answer the row already holds, so the
   * stored answer goes out with no re-check (rule 6). Default: the row is
   * `accepted`. A kind whose question takes several answers (a journey's
   * runs, E7) decides per request — and may throw: an answer that conflicts
   * with the one the row holds is refused before anything is claimed.
   */
  isReplay?(row: Row): boolean;
}

/** No such suggestion of this account — or it went with the history it came from (E5). */
const notFound = () => new AppError("Suggestion not found", 404, "SUGGESTION_NOT_FOUND");
export const disabled = () =>
  new AppError("TravTrack is switched off on this server", 403, "TRAVTRACK_DISABLED");
const inProgress = () =>
  new AppError(
    "This suggestion is being accepted; try again",
    409,
    "SUGGESTION_ACCEPT_IN_PROGRESS"
  );
export const unverifiable = () =>
  new AppError(
    "The evidence for this suggestion cannot be checked right now",
    409,
    "EVIDENCE_UNVERIFIABLE"
  );
const historyChanged = () =>
  new AppError(
    "The location history changed while this suggestion was accepted",
    409,
    "HISTORY_CHANGED"
  );
const invalidated = () =>
  new AppError("The evidence for this suggestion no longer holds", 409, "EVIDENCE_INVALIDATED");

export type AcceptHooks = {
  /** Test seam: runs after the first read, before the claim. */
  afterLoad?: () => Promise<unknown>;
  /** Test seam: after each re-check, before its publication. */
  afterRecheck?: () => Promise<unknown>;
  /** Test seam: inside the publication, the claim held, just before its write. */
  beforeWrite?: () => Promise<unknown>;
};

/**
 * Refuses a request the row can never take (throws the client's error). Runs
 * on the row as first read, before the claim, and again on the row as claimed.
 */
type Validate<Row> = (row: Row) => Promise<void>;

const replays = <Row extends ClaimState, Entry>(store: ClaimStore<Row, Entry>, row: Row) =>
  store.isReplay ? store.isReplay(row) : row.status === "accepted";

async function claim<Row extends ClaimState, Entry>(
  id: string,
  store: ClaimStore<Row, Entry>,
  hooks: AcceptHooks,
  validate: Validate<Row> | undefined
): Promise<{ token: string; row: Row } | { replay: Entry }> {
  const loaded = await store.find(id);
  if (!loaded) throw notFound();
  if (replays(store, loaded)) return { replay: store.replay(loaded) };
  await store.assertAllowed(loaded);
  await validate?.(loaded);
  await hooks.afterLoad?.();
  const token = crypto.randomUUID();
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS);
  const row = await store.claim(id, token, staleBefore);
  if (row) return { token, row };
  // Lost the race, or not claimable: say which, from what the row is now.
  const current = await store.find(id);
  if (!current) throw notFound();
  if (replays(store, current)) return { replay: store.replay(current) };
  if (current.status === "accepting") throw inProgress();
  throw new AppError("Suggestion already resolved", 409, store.resolvedCode);
}

type Published<Entry> = { entry: Entry } | { invalidated: true } | { gone: true } | { moved: true };

async function publish<Row extends ClaimState, Entry>(
  userId: string,
  row: Row & { id: string },
  token: string,
  checked: Recheck,
  store: ClaimStore<Row, Entry>,
  apply: (tx: DbTransaction) => Promise<Entry>,
  hooks: AcceptHooks
): Promise<Published<Entry>> {
  // READ COMMITTED on purpose: every check below must see what committed
  // while this transaction waited for the locks. A serializable snapshot is
  // taken at the first statement — the lock request — and would read the
  // generation, the places and the visits as they were before the work it
  // waited behind.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx): Promise<Published<Entry>> => {
          await takeTravTrackLock(tx, userId); // lock order (1)
          await store.lock?.(tx); // lock order (2)
          await store.assertAllowedIn(tx, row);
          const held = await store.holdsClaim(tx, row.id, token); // lock order (3)
          if (held === "gone") return { gone: true };
          if (held === "lost") throw inProgress();
          if ((await historyGeneration(tx, userId)) !== checked.generation) return { moved: true };
          await hooks.beforeWrite?.();
          if (checked.outcome === "invalidated") {
            await store.invalidate(tx, row, token);
            return { invalidated: true };
          }
          return { entry: await apply(tx) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 }
      );
    } catch (error) {
      if (!isRetryable(error)) throw error;
    }
  }
  throw inProgress();
}

/**
 * A conflict the next attempt may not meet: a serialization failure, or a
 * deadlock. Widening a shared trip locks the other members' accounts while
 * this account's lock (1) is held, so it can meet a member's own period save
 * in the opposite order; Postgres aborts one side whole, and it is retried.
 */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  return error.code === "P2010" && (error.meta as { code?: string } | undefined)?.code === "40P01";
}

export async function acceptFlow<Row extends ClaimState & { id: string }, Entry>(opts: {
  userId: string;
  id: string;
  store: ClaimStore<Row, Entry>;
  /** Step 2, against the row as claimed; captures the generation before it reads. */
  recheck: (row: Row) => Promise<Recheck>;
  /**
   * Step 3's write when the evidence holds, inside the publication
   * transaction: the entry, and the row marked accepted under `token`.
   */
  apply: (tx: DbTransaction, row: Row, token: string) => Promise<Entry>;
  /** Refuses a request the row can never take; before the claim and on the claimed row. */
  validate?: Validate<Row>;
  hooks?: AcceptHooks;
}): Promise<Entry> {
  const { userId, id, store } = opts;
  const hooks = opts.hooks ?? {};
  const claimed = await claim(id, store, hooks, opts.validate);
  if ("replay" in claimed) return claimed.replay;
  const { token, row } = claimed;
  let handedBack = false;
  try {
    // The claim read the row as it is now; it may have taken this answer meanwhile.
    if (replays(store, row)) {
      handedBack = true;
      await store.release(id, token);
      return store.replay(row);
    }
    await opts.validate?.(row);
    for (let round = 0; round < 2; round++) {
      const checked = await opts.recheck(row);
      await hooks.afterRecheck?.();
      // Cannot be checked now: neither accepted nor invalidated; the claim is
      // handed back below and the suggestion stays open.
      if (checked.outcome === "unverifiable") throw unverifiable();
      const outcome = await publish(
        userId,
        row,
        token,
        checked,
        store,
        (tx) => opts.apply(tx, row, token),
        hooks
      );
      if ("entry" in outcome) return outcome.entry;
      if ("invalidated" in outcome || "gone" in outcome) {
        handedBack = true;
        // Committed above (or removed with its history); the answer leaves only now.
        logger.info(
          {
            operation: "EvidenceInvalidated",
            userId,
            suggestionId: id,
            reason: "invalidated" in outcome ? "recheck" : "historyDeleted",
          },
          "Suggestion not accepted: its evidence no longer holds"
        );
        throw invalidated();
      }
      // The history moved between re-check and publication: read it again.
    }
    // It moved again. Nothing says the evidence is gone, so nothing is
    // invalidated: the claim is handed back and the answer says "try again".
    throw historyChanged();
  } catch (error) {
    if (!handedBack) await store.release(id, token);
    throw error;
  }
}
