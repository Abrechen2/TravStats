/**
 * Folds a plan's `state.packing` into its trip's packing list (forgejo#398).
 *
 * One transaction per plan, guarded by `travel_plans.packing_migrated_at`, so
 * running it again changes nothing. It runs lazily before a plan's packing is
 * read or written, and once at boot for every plan that still has the marker
 * unset. Nothing private is published: a personal item stays personal to the
 * same principal, and an owner that no member row names is kept under an id
 * nobody holds.
 */
import { createHash } from "node:crypto";
import { prisma } from "../../db";
import type { DbTransaction } from "../../db";
import logger from "../../utils/logger";
import type { PackingPrincipal, RichPackingItem } from "../../schemas/companionData";
import { canonicalOwner, normalizeItem, sameServerAccount } from "../packing/items";
import { loadList, saveList } from "../packing/store";
import { loadPlanPeople } from "./packingBridge";
import { parseState } from "./upgrade";
import type { PlanPacking } from "./types";

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function freeId(id: string, planId: string, taken: ReadonlySet<string>): string {
  for (let n = 0; ; n += 1) {
    const tag = createHash("sha1").update(`${planId}:${id}:${n}`).digest("hex").slice(0, 8);
    const candidate = `${id.slice(0, 64 - 9)}-${tag}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Is this stored item one the Companion's copy could have come from (an untouched default)? */
const isPlainCopy = (item: RichPackingItem) =>
  item.scope === "personal" && item.ownerPrincipal === null;

export function mergePlanPacking(
  stored: readonly RichPackingItem[],
  legacy: readonly PlanPacking[],
  resolve: (memberId: string | null) => PackingPrincipal | null,
  planId: string
): RichPackingItem[] {
  const next = [...stored];
  const taken = new Set(next.map((i) => i.id));
  for (const b of legacy) {
    const principal = resolve(b.ownerMemberId);
    const rich = normalizeItem({
      id: b.id,
      label: b.label,
      done: b.packed,
      category: b.category,
      quantity: b.quantity,
      scope: b.scope,
      note: b.note,
      manual: b.manual,
      ownerPrincipal: b.scope === "personal" ? principal : null,
      assigneePrincipal: b.scope === "shared" ? principal : null,
    });
    const at = next.findIndex((a) => a.id === b.id);
    // Only the owner's own item can be the Companion's copy of the owner's list item.
    const ownersOwn = b.scope === "personal" && principal === null;
    if (at >= 0 && ownersOwn && isPlainCopy(next[at]) && sameLabel(next[at].label, b.label)) {
      // The same item twice: the Companion copied the list into the plan.
      next[at] = {
        ...rich,
        id: next[at].id,
        label: next[at].label,
        done: next[at].done || b.packed,
      };
      continue;
    }
    const id = at >= 0 ? freeId(b.id, planId, taken) : b.id;
    taken.add(id);
    next.push({ ...rich, id });
  }
  return next;
}

async function migrateLocked(tx: DbTransaction, planId: string): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM travel_plans WHERE id = ${planId} FOR UPDATE`;
  const plan = await tx.travelPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      tripId: true,
      state: true,
      packingMigratedAt: true,
      trip: { select: { userId: true } },
    },
  });
  if (!plan || plan.packingMigratedAt) return false;
  const ownerId = plan.trip.userId;
  const legacy = parseState(plan.state).packing;
  if (legacy.length) {
    const people = await loadPlanPeople(tx, plan.id, ownerId);
    const owner = sameServerAccount(ownerId);
    const list = await loadList(tx, plan.tripId, true);
    const resolve = (memberId: string | null): PackingPrincipal | null => {
      if (memberId === null) return null;
      const principal = people.principals.get(memberId);
      if (!principal) return { server: "plan-member", subjectId: memberId };
      return canonicalOwner(principal, { principal: owner, isTripOwner: true });
    };
    const items = mergePlanPacking(list.items, legacy, resolve, plan.id);
    await saveList(tx, {
      tripId: plan.tripId,
      ownerId,
      items,
      baseRev: list.rev,
      mutationId: null,
    });
  }
  await tx.travelPlan.update({ where: { id: plan.id }, data: { packingMigratedAt: new Date() } });
  return true;
}

/** Folds the plan's packing in once; true when this call did it. */
export async function ensurePackingMigrated(planId: string): Promise<boolean> {
  return prisma.$transaction((tx) => migrateLocked(tx, planId), { timeout: 30_000 });
}

/** Every plan not yet folded in, one transaction each; a failing plan is logged and skipped. */
export async function migrateAllPlanPacking(): Promise<number> {
  const rows = await prisma.travelPlan.findMany({
    where: { packingMigratedAt: null },
    select: { id: true },
  });
  let done = 0;
  for (const { id } of rows) {
    try {
      if (await ensurePackingMigrated(id)) done += 1;
    } catch (error) {
      logger.warn({ operation: "packing.migrate", planId: id, error: String(error) }, "skipped");
    }
  }
  return done;
}
