import { prisma } from "../../db";
import { SHARE_ENTITIES, type ShareEntity } from "./adapters";
import { sharedIdsOf } from "./keyOps";
import { propagateDeletes, propagateWrites, shareSnapshots, type ShareSnapshot } from "./propagate";

/**
 * Propagation for a bulk write that touches many rows through many helpers —
 * the spreadsheet import: one snapshot of everything shared before the run,
 * one reconciliation after it. Rows that were shared and are gone are
 * deletes; rows on a shared trip are created, updated or moved as any single
 * write would be (`propagate.ts`).
 */
export type SharedState = Map<ShareEntity, Map<string, ShareSnapshot>>;

export async function sharedStateOf(userId: string): Promise<SharedState> {
  const state: SharedState = new Map();
  for (const entity of SHARE_ENTITIES) {
    state.set(
      entity,
      await shareSnapshots(
        prisma,
        entity,
        await prisma.$transaction((tx) => sharedIdsOf(tx, userId, entity))
      )
    );
  }
  return state;
}

/** After the bulk write: tell, copy and update exactly as single writes would. */
export async function propagateBulk(userId: string, before: SharedState): Promise<void> {
  for (const entity of SHARE_ENTITIES) {
    const snapshots = before.get(entity) ?? new Map<string, ShareSnapshot>();
    const now = new Set(await prisma.$transaction((tx) => sharedIdsOf(tx, userId, entity)));
    const stillThere = await shareSnapshots(prisma, entity, [...snapshots.keys()]);
    const gone = [...snapshots.values()].filter((s) => !stillThere.has(s.id));
    await propagateDeletes(prisma, userId, gone);
    const ids = [...new Set([...now, ...stillThere.keys()])];
    await propagateWrites(prisma, userId, entity, ids, snapshots);
  }
}
