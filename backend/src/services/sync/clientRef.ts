import { createHash } from "node:crypto";

import { expectingUniqueConflict, prisma, type DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { clientRefSchema } from "../../schemas/clientRef";
import { SYNC_RETENTION_DAYS } from "./state";

/**
 * Exactly-once creates for a client that has to repeat itself (forgejo#283).
 *
 * The Companion's offline outbox replays a POST whose answer it never saw — the
 * request may have landed, the response may not. Before this, the app searched
 * the server for "the same" row first (same stations, same minute), which
 * cannot tell a lost answer from a genuine second ride on the same train. Now
 * the app sends a key it minted with the write, and the server remembers which
 * row that key made.
 *
 * One mechanism for every create route that takes the key — the route hands
 * over its create and a way to read the row again, nothing more:
 *
 * - **Repeat, same body** → the existing row, as the route's own body, with
 *   200 instead of 201. Nothing is created.
 * - **Same key, different body or different route** → 409 `CLIENT_REF_REUSED`,
 *   naming the row the key made (`extra.kind`, `extra.entityId`). Answering the
 *   old row would drop the new body in silence — a draft corrected offline
 *   after the first send landed is exactly that case, and the app can turn it
 *   into a PATCH of `entityId`.
 * - **The row is gone** (deleted since, on any device) → 410
 *   `CLIENT_REF_TARGET_GONE`. Creating it again would resurrect what the person
 *   deleted.
 *
 * Race-safe without read-then-write: the key row is inserted in the SAME
 * transaction as the entity, under a unique (user, key) index. A concurrent
 * second request blocks on that index until the first commits, then fails with
 * a unique violation, which rolls its own entity back and answers the winner's
 * row as a repeat. The read before the create is only a fast path that spares
 * a repeat the route's expensive work (geometry, FX).
 *
 * Its own table rather than a column per domain table: one index, one prune,
 * and nothing for export, backup schema or the sync feed to carry — the key is
 * transport bookkeeping, not travel data. It is kept as long as the change feed
 * keeps its tombstones (`SYNC_RETENTION_DAYS`): an outbox that stayed offline
 * longer than that has to resync in full anyway, and a key row costs ~150
 * bytes. Pruned by the sync retention job.
 */

export type ClientRefKind = "rail" | "bus" | "ferry" | "expense" | "tour" | "note";

export const CLIENT_REF_RETENTION_DAYS = SYNC_RETENTION_DAYS;

/** Records the key for the row just created, inside the creating transaction. */
export type ClaimClientRef = (tx: DbTransaction, entityId: string) => Promise<void>;

/**
 * Splits `clientRef` off a request body, so the route's own (often strict)
 * schema never sees it. A malformed key is a 400 on `clientRef`, never ignored —
 * ignoring it would quietly turn an exactly-once write back into at-least-once.
 */
export function takeClientRef(body: unknown): { clientRef: string | null; rest: unknown } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { clientRef: null, rest: body };
  }
  const { clientRef, ...rest } = body as Record<string, unknown>;
  if (clientRef === undefined) return { clientRef: null, rest: body };
  const parsed = clientRefSchema.safeParse(clientRef);
  if (!parsed.success) {
    throw new AppError(
      "clientRef must be 1–64 characters of A–Z a–z 0–9 . _ : -",
      400,
      "VALIDATION_FAILED",
      "clientRef"
    );
  }
  return { clientRef: parsed.data, rest };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

/** sha256 of the payload's JSON with every object's keys sorted — key order is not a difference. */
export function payloadHash(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(payload)) ?? "null")
    .digest("hex");
}

class ClientRefRace extends Error {}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

interface RefRow {
  kind: string;
  entityId: string;
  payloadHash: string;
}

async function findRef(userId: string, clientRef: string): Promise<RefRow | null> {
  return prisma.clientWriteRef.findUnique({
    where: { userId_clientRef: { userId, clientRef } },
    select: { kind: true, entityId: true, payloadHash: true },
  });
}

async function answerRepeat<R>(
  prior: RefRow,
  kind: ClientRefKind,
  hash: string,
  replay: (entityId: string) => Promise<R | null>
): Promise<R> {
  if (prior.kind !== kind || prior.payloadHash !== hash) {
    throw new AppError(
      "This clientRef was already used for a different write",
      409,
      "CLIENT_REF_REUSED",
      "clientRef",
      { kind: prior.kind, entityId: prior.entityId }
    );
  }
  const row = await replay(prior.entityId);
  if (row === null) {
    throw new AppError(
      "The row this clientRef created has been deleted since",
      410,
      "CLIENT_REF_TARGET_GONE",
      "clientRef",
      { kind: prior.kind, entityId: prior.entityId }
    );
  }
  return row;
}

export interface CreateOnceInput<R> {
  userId: string;
  /** From {@link takeClientRef}; null runs the create as if this module did not exist. */
  clientRef: string | null;
  kind: ClientRefKind;
  /** What makes two writes "the same": the body without the key, plus any path scope. */
  payload: unknown;
  /** The route's create. It must call `claim(tx, id)` inside its transaction. */
  create: (claim: ClaimClientRef) => Promise<R>;
  /** The row again, as the route answers it; null when it is gone. */
  replay: (entityId: string) => Promise<R | null>;
}

/** Runs a create at most once per (user, clientRef). `created` false = a repeat, answer 200. */
export async function createOnce<R>(
  input: CreateOnceInput<R>
): Promise<{ created: boolean; result: R }> {
  const { userId, clientRef, kind, create, replay } = input;
  if (clientRef === null) return { created: true, result: await create(async () => {}) };

  const hash = payloadHash(input.payload);
  const prior = await findRef(userId, clientRef);
  if (prior) return { created: false, result: await answerRepeat(prior, kind, hash, replay) };

  try {
    const result = await create(async (tx, entityId) => {
      try {
        await expectingUniqueConflict("ClientWriteRef", () =>
          tx.clientWriteRef.create({
            data: { userId, clientRef, kind, entityId, payloadHash: hash },
          })
        );
      } catch (err) {
        // Another request with this key committed first. Throwing rolls this
        // transaction — and the row it just created — back.
        if (isUniqueViolation(err)) throw new ClientRefRace();
        throw err;
      }
    });
    return { created: true, result };
  } catch (err) {
    if (!(err instanceof ClientRefRace)) throw err;
    const winner = await findRef(userId, clientRef);
    if (!winner) throw new AppError("clientRef could not be settled; send again", 503);
    return { created: false, result: await answerRepeat(winner, kind, hash, replay) };
  }
}

/** Deletes keys past the retention horizon. Called by the sync retention job. */
export async function pruneClientRefs(
  now: Date = new Date(),
  retentionDays: number = CLIENT_REF_RETENTION_DAYS
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.clientWriteRef.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}
