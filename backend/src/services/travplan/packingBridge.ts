/**
 * TravPlan's view of the trip's one packing list (forgejo#398).
 *
 * The list lives in `TripPackingList`; a plan member is named there by
 * principal `{server, subjectId}`, the plan names members by member id. This
 * file maps between the two, draws the filtered projection into the plan view
 * and turns the plan's packing operations (upsert, remove, undo) into commands
 * on the list. `state.packing` in the plan JSON is read-only history now (the
 * migration folds it into the list once, `packingMigration.ts`).
 */
import type { DbTransaction } from "../../db";
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { PackingPrincipal, RichPackingItem } from "../../schemas/companionData";
import {
  canonicalOwner,
  isVisible,
  normalizeItem,
  projectFor,
  sameServerAccount,
  samePrincipal,
  type PackingViewer,
} from "../packing/items";
import { assertWithinLimit, loadList, saveList } from "../packing/store";
import { ensureOwnerMember } from "./access";
import { packingSchema } from "./schema";
import type { PlanOperation, PlanPacking } from "./types";

type Client = DbTransaction | typeof prisma;

/** A principal no account or connection can match: whoever it names is gone. */
const tombstone = (memberId: string): PackingPrincipal => ({
  server: "plan-member",
  subjectId: memberId,
});

interface PlanPeople {
  ownerMemberId: string;
  ownerId: string;
  principals: Map<string, PackingPrincipal>;
  /** Member ids that are on the plan now (not invited, left or revoked). */
  active: Set<string>;
}

/** Every member of the plan, left ones too (their items stay theirs), by member id. */
export async function loadPlanPeople(
  client: Client,
  planId: string,
  ownerId: string
): Promise<PlanPeople> {
  const owner = await ensureOwnerMember(client, planId, ownerId);
  const rows = await client.travelPlanMember.findMany({
    where: { planId },
    select: {
      id: true,
      kind: true,
      userId: true,
      status: true,
      connection: { select: { origin: true, channel: true } },
    },
  });
  const principals = new Map<string, PackingPrincipal>();
  const active = new Set<string>([owner.id]);
  for (const m of rows) {
    if (m.status === "active") active.add(m.id);
    if (m.kind === "remote")
      principals.set(
        m.id,
        m.connection
          ? { server: m.connection.origin, subjectId: m.connection.channel }
          : tombstone(m.id)
      );
    else principals.set(m.id, m.userId ? sameServerAccount(m.userId) : tombstone(m.id));
  }
  return { ownerMemberId: owner.id, ownerId, principals, active };
}

export function viewerOf(people: PlanPeople, memberId: string): PackingViewer {
  const principal = people.principals.get(memberId);
  if (!principal) throw new AppError("Not a member of this plan", 400, "PLAN_MEMBER_UNKNOWN");
  return { principal, isTripOwner: memberId === people.ownerMemberId };
}

const memberIdOf = (people: PlanPeople, principal: PackingPrincipal | null): string | null => {
  if (!principal) return null;
  for (const [id, p] of people.principals) if (samePrincipal(p, principal)) return id;
  return null;
};

/** The plan's form of a stored item; a personal item of a departed principal gets an id nobody has. */
export function toPlanItem(item: RichPackingItem, people: PlanPeople): PlanPacking {
  const personal = item.scope === "personal";
  const ownerMemberId = personal
    ? item.ownerPrincipal === null
      ? people.ownerMemberId
      : (memberIdOf(people, item.ownerPrincipal) ?? `gone:${item.ownerPrincipal.subjectId}`)
    : memberIdOf(people, item.assigneePrincipal);
  return {
    id: item.id,
    label: item.label,
    category: item.category,
    quantity: item.quantity,
    packed: item.done,
    scope: item.scope,
    note: item.note,
    manual: item.manual,
    ownerMemberId,
  };
}

/** What `memberId` sees of the trip's list, in the plan's item shape. */
export async function planPackingFor(
  client: Client,
  args: { planId: string; tripId: string; ownerId: string; memberId: string }
): Promise<{ items: PlanPacking[]; rev: number }> {
  const [people, list] = await Promise.all([
    loadPlanPeople(client, args.planId, args.ownerId),
    loadList(client, args.tripId),
  ]);
  const viewer = viewerOf(people, args.memberId);
  return {
    items: projectFor(list.items, viewer).map((item) => toPlanItem(item, people)),
    rev: list.rev,
  };
}

/** Every item, hidden ones included: for the authorisation check only, never drawn. */
export async function fullPlanPacking(
  client: Client,
  args: { planId: string; tripId: string; ownerId: string }
): Promise<PlanPacking[]> {
  const [people, list] = await Promise.all([
    loadPlanPeople(client, args.planId, args.ownerId),
    loadList(client, args.tripId),
  ]);
  return list.items.map((item) => toPlanItem(item, people));
}

export type PackingOperation =
  | { type: "upsert"; collection: "packing"; value: Record<string, unknown> }
  | { type: "remove"; collection: "packing"; id: string };

export const isPackingOperation = (operation: PlanOperation): operation is PackingOperation =>
  (operation.type === "upsert" || operation.type === "remove") &&
  operation.collection === "packing";

/** What a packing change leaves for the receipt, so the undo can restore it. */
export interface PackingTouch {
  items: RichPackingItem[];
  revAfter: number;
}

const notFound = () => new AppError("Plan entry not found", 404, "PLAN_ITEM_NOT_FOUND");

interface CommandContext {
  tx: DbTransaction;
  planId: string;
  tripId: string;
  ownerId: string;
  memberId: string;
}

/** An upsert or remove on the list, with the compare-and-swap on its rev under the row lock. */
export async function applyPackingOperation(
  ctx: CommandContext,
  operation: PackingOperation,
  basePackingRev?: number
): Promise<PackingTouch> {
  const people = await loadPlanPeople(ctx.tx, ctx.planId, ctx.ownerId);
  const viewer = viewerOf(people, ctx.memberId);
  const list = await loadList(ctx.tx, ctx.tripId, true);
  // A client that drew the list at some rev says so: a list that moved on since (the Companion
  // writes it without touching the plan's revision) is refused, not overwritten.
  if (basePackingRev !== undefined && basePackingRev !== list.rev)
    throw new AppError(
      "The packing list changed; refresh before applying this edit",
      409,
      "PLAN_REVISION_CONFLICT"
    );
  const index = (id: string) => list.items.findIndex((i) => i.id === id);
  let next: RichPackingItem[];
  if (operation.type === "remove") {
    const at = index(operation.id);
    // Another member's personal item is "not found", as it is in the plan.
    if (at < 0 || !isVisible(list.items[at], viewer)) throw notFound();
    next = list.items.filter((_, i) => i !== at);
  } else {
    const value = packingSchema.parse(operation.value);
    const at = index(value.id);
    if (at >= 0 && !isVisible(list.items[at], viewer)) throw notFound();
    const item = normalizeItem({
      id: value.id,
      label: value.label,
      done: value.packed,
      category: value.category,
      quantity: value.quantity,
      scope: value.scope,
      note: value.note,
      manual: value.manual,
      ownerPrincipal:
        value.scope === "personal"
          ? canonicalOwner(
              people.principals.get(value.ownerMemberId ?? ctx.memberId) ?? null,
              viewer
            )
          : null,
      assigneePrincipal:
        value.scope === "shared" && value.ownerMemberId
          ? (people.principals.get(value.ownerMemberId) ?? null)
          : null,
    });
    next = at >= 0 ? list.items.map((x, i) => (i === at ? item : x)) : [...list.items, item];
    assertWithinLimit(next.length, list.items.length);
  }
  const saved = await saveList(ctx.tx, {
    tripId: ctx.tripId,
    ownerId: ctx.ownerId,
    items: next,
    baseRev: list.rev,
    mutationId: null,
  });
  return { items: list.items, revAfter: saved.rev };
}

/**
 * Restores what a packing change replaced, cut down to what the actor could
 * have done by hand: items they cannot see stay as they are now. A list that
 * moved on since (another writer raised the rev) is refused: undoing would
 * silently revert that writer.
 */
export async function undoPackingChange(
  ctx: CommandContext,
  saved: PackingTouch
): Promise<PackingTouch> {
  const people = await loadPlanPeople(ctx.tx, ctx.planId, ctx.ownerId);
  const viewer = viewerOf(people, ctx.memberId);
  const list = await loadList(ctx.tx, ctx.tripId, true);
  if (list.rev !== saved.revAfter)
    throw new AppError("Only the latest change can be undone", 409, "PLAN_UNDO_STALE");
  const before = saved.items.map(normalizeItem);
  const restoredVisible = projectFor(before, viewer);
  const hiddenNow = list.items.filter((i) => !isVisible(i, viewer));
  // The saved order, with what the actor cannot see put back where it is now.
  const hiddenIds = new Set(hiddenNow.map((i) => i.id));
  const next = [...restoredVisible.filter((i) => !hiddenIds.has(i.id)), ...hiddenNow];
  const result = await saveList(ctx.tx, {
    tripId: ctx.tripId,
    ownerId: ctx.ownerId,
    items: next,
    baseRev: list.rev,
    mutationId: null,
  });
  return { items: list.items, revAfter: result.rev };
}

/** The owner's own projection of the trip's list, in the plan's item shape. */
export async function ownerPlanPacking(
  client: Client,
  args: { planId: string; tripId: string; ownerId: string }
): Promise<{ items: PlanPacking[]; rev: number }> {
  const people = await loadPlanPeople(client, args.planId, args.ownerId);
  return planPackingFor(client, { ...args, memberId: people.ownerMemberId });
}

/**
 * Who a shared item may be assigned to through the trip's own routes: the owner
 * or a member of the trip's plan. Anyone else is refused.
 */
export async function assertAssignable(
  tripId: string,
  ownerId: string,
  principals: readonly PackingPrincipal[]
): Promise<void> {
  if (!principals.length) return;
  const allowed: PackingPrincipal[] = [sameServerAccount(ownerId)];
  const plan = await prisma.travelPlan.findUnique({ where: { tripId }, select: { id: true } });
  if (plan) {
    const people = await loadPlanPeople(prisma, plan.id, ownerId);
    for (const id of people.active) {
      const p = people.principals.get(id);
      if (p) allowed.push(p);
    }
  }
  if (principals.some((p) => !allowed.some((a) => samePrincipal(a, p))))
    throw new AppError(
      "A shared item can only be assigned to someone on the trip",
      400,
      "PACKING_ASSIGNEE_UNKNOWN"
    );
}
