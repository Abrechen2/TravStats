import { z } from "zod";

/**
 * The sync cursor: opaque to the client, a position in transaction order here.
 *
 * WHY NOT A TIMESTAMP. "Everything with updatedAt > T" misses writes twice
 * over. Clocks: `updatedAt` is stamped by whichever Node process wrote the
 * row, so a host whose clock is behind writes into the past of a cursor that
 * has already moved on. Transactions: a stamp is taken when the write
 * happens, not when it COMMITS — a transaction that writes at 12:00:00.100
 * and commits at 12:00:02 is invisible to a reader at 12:00:01, who then
 * hands out a cursor of 12:00:01 and never sees that row. A plain sequence
 * (`sync_changes.seq`) has the second problem in exactly the same shape:
 * numbers are drawn at insert time, so seq 41 can commit after seq 42.
 *
 * WHAT INSTEAD. Every change row records the id of the transaction that
 * wrote it (`pg_current_xact_id()`). A reader's snapshot carries `xmin`, the
 * oldest transaction still running: every transaction with a smaller id has
 * finished — committed or rolled back — so nothing below `xmin` can appear
 * later. The feed therefore only ever hands out rows with `xid < xmin`, in
 * (xid, seq) order, and a cursor is the (xid, seq) of the last row handed
 * out. A row from a transaction still in flight is held back until it ends,
 * and then arrives — after rows the client already has, which is fine,
 * because nothing after the cursor was skipped. The price is latency: one
 * long write transaction — anywhere on the PostgreSQL server, since
 * transaction ids are cluster-wide — holds the feed at its start until it
 * ends. Write transactions here last milliseconds; a stalled one shows as a
 * feed that stops advancing, never as a feed that skips.
 *
 * A cursor also carries the feed's epoch (a database restore starts a new
 * history) and the account's domain scope (`scopeFingerprint`); either
 * changing means the client's copy cannot be patched forward.
 */

export type DeltaCursor = {
  readonly mode: "delta";
  readonly epoch: string;
  readonly scope: string;
  /** Everything at or below (xid, seq) has been handed out. */
  readonly xid: bigint;
  readonly seq: bigint;
};

export type FullCursor = {
  readonly mode: "full";
  readonly epoch: string;
  readonly scope: string;
  /** The snapshot horizon the full read started at; the delta resumes there. */
  readonly startXid: bigint;
  /** Index into SYNC_ENTITIES of the entity being listed. */
  readonly entityIndex: number;
  /** Last id handed out within that entity, or null at its start. */
  readonly afterId: string | null;
};

export type SyncCursor = DeltaCursor | FullCursor;

const BIGINT_TEXT = z.string().regex(/^\d{1,20}$/);

const wireSchema = z.discriminatedUnion("m", [
  z.object({
    v: z.literal(1),
    m: z.literal("d"),
    ep: z.string().min(1).max(64),
    sc: z.string().max(200),
    x: BIGINT_TEXT,
    s: BIGINT_TEXT,
  }),
  z.object({
    v: z.literal(1),
    m: z.literal("f"),
    ep: z.string().min(1).max(64),
    sc: z.string().max(200),
    h: BIGINT_TEXT,
    e: z.number().int().min(0).max(100),
    a: z.string().max(100).nullable(),
  }),
]);

export function encodeCursor(cursor: SyncCursor): string {
  const wire =
    cursor.mode === "delta"
      ? {
          v: 1,
          m: "d",
          ep: cursor.epoch,
          sc: cursor.scope,
          x: cursor.xid.toString(),
          s: cursor.seq.toString(),
        }
      : {
          v: 1,
          m: "f",
          ep: cursor.epoch,
          sc: cursor.scope,
          h: cursor.startXid.toString(),
          e: cursor.entityIndex,
          a: cursor.afterId,
        };
  return Buffer.from(JSON.stringify(wire), "utf8").toString("base64url");
}

/** The cursor, or null when the string is not one this server minted. */
export function decodeCursor(text: string): SyncCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const result = wireSchema.safeParse(parsed);
  if (!result.success) return null;
  const wire = result.data;
  if (wire.m === "d") {
    return {
      mode: "delta",
      epoch: wire.ep,
      scope: wire.sc,
      xid: BigInt(wire.x),
      seq: BigInt(wire.s),
    };
  }
  return {
    mode: "full",
    epoch: wire.ep,
    scope: wire.sc,
    startXid: BigInt(wire.h),
    entityIndex: wire.e,
    afterId: wire.a,
  };
}

/** (xid, seq) ordering: negative, zero or positive like a comparator. */
export function comparePosition(
  a: { xid: bigint; seq: bigint },
  b: { xid: bigint; seq: bigint }
): number {
  if (a.xid !== b.xid) return a.xid < b.xid ? -1 : 1;
  if (a.seq !== b.seq) return a.seq < b.seq ? -1 : 1;
  return 0;
}
