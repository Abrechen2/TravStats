/**
 * The trip's packing list in the database — the one store (forgejo#398).
 *
 * `loadList`/`saveList` are the commands both the trip routes and the TravPlan
 * operations go through, always inside a transaction that holds the row lock,
 * so a write names the `rev` it started from and meets a 409 when the list
 * moved on. Writes through the trip routes are answered from durable receipts
 * (`packing_mutations`, per actor), so a resend after a lost answer is
 * idempotent even when another device wrote in between.
 */
import { prisma } from "../../db";
import type { DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import {
  PACKING_MAX_ITEMS,
  type PackingItem,
  type RichPackingItem,
} from "../../schemas/companionData";
import {
  actorKey,
  normalizeItems,
  projectFor,
  replaceVisible,
  toLegacy,
  type PackingViewer,
} from "./items";

export interface PackingState {
  items: RichPackingItem[];
  rev: number;
  updatedAt: Date | null;
  lastMutationId: string | null;
}

export interface VisiblePacking {
  items: RichPackingItem[];
  rev: number;
  updatedAt: string | null;
}

export type PackingPayload = {
  items: RichPackingItem[] | PackingItem[];
  rev: number;
  updatedAt: string | null;
  replayed?: true;
};

const RECEIPT_TTL_MS = 30 * 24 * 3600 * 1000;

export function stale(rev: number): AppError {
  return new AppError(
    "The packing list changed since it was read",
    409,
    "PACKING_LIST_STALE",
    undefined,
    { rev }
  );
}

/** Reads the list; with `lock`, holds its row until the transaction ends. */
export async function loadList(
  client: Pick<DbTransaction, "tripPackingList" | "$queryRaw">,
  tripId: string,
  lock = false
): Promise<PackingState> {
  if (lock)
    await client.$queryRaw`SELECT id FROM trip_packing_lists WHERE trip_id = ${tripId} FOR UPDATE`;
  const row = await client.tripPackingList.findUnique({ where: { tripId } });
  return {
    items: row ? normalizeItems(row.items) : [],
    rev: row?.rev ?? 0,
    updatedAt: row?.updatedAt ?? null,
    lastMutationId: row?.lastMutationId ?? null,
  };
}

/**
 * Stores `items` as the next rev. `baseRev` 0 creates the list (a P2002 means
 * another write created it first: the caller treats that as stale or replay).
 */
export async function saveList(
  tx: DbTransaction,
  args: {
    tripId: string;
    ownerId: string;
    items: readonly RichPackingItem[];
    baseRev: number;
    mutationId: string | null;
  }
): Promise<{ rev: number; updatedAt: Date }> {
  const json = args.items as unknown as Prisma.InputJsonValue;
  if (args.baseRev === 0) {
    const created = await tx.tripPackingList.create({
      data: {
        userId: args.ownerId,
        tripId: args.tripId,
        items: json,
        rev: 1,
        lastMutationId: args.mutationId,
      },
    });
    return { rev: created.rev, updatedAt: created.updatedAt };
  }
  const { count } = await tx.tripPackingList.updateMany({
    where: { tripId: args.tripId, rev: args.baseRev },
    data: { items: json, rev: { increment: 1 }, lastMutationId: args.mutationId },
  });
  const after = await tx.tripPackingList.findUnique({ where: { tripId: args.tripId } });
  if (count === 0 || !after) throw stale(after?.rev ?? 0);
  return { rev: after.rev, updatedAt: after.updatedAt };
}

export function assertWithinLimit(next: number, stored: number): void {
  // Over the adding limit only while it does not grow: a merged list may be long.
  if (next > PACKING_MAX_ITEMS && next > stored)
    throw new AppError(`At most ${PACKING_MAX_ITEMS} items`, 400, "PACKING_LIST_INVALID");
}

const payloadOf = (visible: VisiblePacking, rich: boolean, replayed = false): PackingPayload => ({
  items: rich ? visible.items : visible.items.map(toLegacy),
  rev: visible.rev,
  updatedAt: visible.updatedAt,
  ...(replayed ? { replayed: true as const } : {}),
});

export async function readVisible(
  tripId: string,
  viewer: PackingViewer,
  rich: boolean
): Promise<PackingPayload> {
  const state = await loadList(prisma, tripId);
  return payloadOf(
    {
      items: projectFor(state.items, viewer),
      rev: state.rev,
      updatedAt: state.updatedAt?.toISOString() ?? null,
    },
    rich
  );
}

export interface WriteArgs {
  tripId: string;
  ownerId: string;
  viewer: PackingViewer;
  items: readonly (PackingItem | RichPackingItem)[];
  baseRev: number;
  mutationId: string;
  rich: boolean;
}

async function receiptFor(tripId: string, actor: string, mutationId: string) {
  return prisma.packingMutation.findUnique({
    where: { tripId_actor_mutationId: { tripId, actor, mutationId } },
  });
}

export async function writeVisible(args: WriteArgs): Promise<PackingPayload> {
  const actor = actorKey(args.viewer.principal);
  const replay = async (): Promise<PackingPayload | null> => {
    const receipt = await receiptFor(args.tripId, actor, args.mutationId);
    return receipt ? payloadOf(receipt.result as unknown as VisiblePacking, args.rich, true) : null;
  };
  const first = await replay();
  if (first) return first;
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await loadList(tx, args.tripId, true);
      // The same write racing its own first send: the row lock made it wait.
      const done = await tx.packingMutation.findUnique({
        where: {
          tripId_actor_mutationId: { tripId: args.tripId, actor, mutationId: args.mutationId },
        },
      });
      if (done) return payloadOf(done.result as unknown as VisiblePacking, args.rich, true);
      // A write whose answer was lost before receipts existed.
      if (current.lastMutationId === args.mutationId && args.viewer.isTripOwner)
        return payloadOf(
          {
            items: projectFor(current.items, args.viewer),
            rev: current.rev,
            updatedAt: current.updatedAt?.toISOString() ?? null,
          },
          args.rich,
          true
        );
      if (args.baseRev !== current.rev) throw stale(current.rev);
      const next = replaceVisible(
        current.items,
        args.items,
        args.viewer,
        args.rich ? "rich" : "legacy"
      );
      assertWithinLimit(next.length, current.items.length);
      const saved = await saveList(tx, {
        tripId: args.tripId,
        ownerId: args.ownerId,
        items: next,
        baseRev: current.rev,
        mutationId: args.mutationId,
      });
      const visible: VisiblePacking = {
        items: projectFor(next, args.viewer),
        rev: saved.rev,
        updatedAt: saved.updatedAt.toISOString(),
      };
      await tx.packingMutation.deleteMany({
        where: { tripId: args.tripId, createdAt: { lt: new Date(Date.now() - RECEIPT_TTL_MS) } },
      });
      await tx.packingMutation.create({
        data: {
          tripId: args.tripId,
          actor,
          mutationId: args.mutationId,
          result: visible as unknown as Prisma.InputJsonValue,
        },
      });
      return payloadOf(visible, args.rich);
    });
  } catch (error) {
    // Another write created the list (or this very write) a moment earlier.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await replay();
      if (winner) return winner;
      throw stale((await loadList(prisma, args.tripId)).rev);
    }
    throw error;
  }
}
