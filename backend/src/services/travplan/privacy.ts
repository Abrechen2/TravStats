/**
 * What each member sees and may change (spec 2026-10-17 §6.1, §6.2, D3).
 *
 * A pure layer: the store resolves who is acting and which members are active, this file decides.
 * Personal packing items and member notes are filtered out of the view (never merely hidden by
 * the client), and an operation that would reach another member's part is refused as if that part
 * did not exist.
 */
import { AppError } from "../../middleware/errorHandler";
import { canonical } from "./canonical";
import type { PlanOperation, PlanPacking, PlanState } from "./types";

export interface Actor {
  memberId: string;
  isOwner: boolean;
}

/** Is this personal item the actor's? An item with no owner predates members: the owner's. */
function isMine(item: PlanPacking, actor: Actor): boolean {
  return item.ownerMemberId === actor.memberId || (item.ownerMemberId === null && actor.isOwner);
}

/** The state as `actor` may see it. */
export function visibleState(state: PlanState, actor: Actor): PlanState {
  return {
    ...state,
    packing: state.packing.filter((p) => p.scope === "shared" || isMine(p, actor)),
    memberNotes: state.memberNotes.filter((n) => n.memberId === actor.memberId),
  };
}

const notFound = () => new AppError("Plan item not found", 404, "PLAN_ITEM_NOT_FOUND");
const ownerOnly = () => new AppError("Only the plan's owner may do this", 403, "PLAN_OWNER_ONLY");
const unknownMember = () => new AppError("Not a member of this plan", 400, "PLAN_MEMBER_UNKNOWN");

/** Operations that write to the OWNER's logbook; an editor confirms nothing there (§6.1). */
const LOGBOOK_OPERATIONS = new Set([
  "link_actual",
  "refresh_existing",
  "handover",
  "station_handover",
  "station_withdraw",
]);

/** The summary of an operation, as stored on its receipt and told to the other members. */
export function summaryOf(operation: PlanOperation): string {
  return "collection" in operation ? `${operation.type}:${operation.collection}` : operation.type;
}

/** A receipt summary that touched the owner's logbook. */
export function isLogbookSummary(summary: string): boolean {
  const type = summary.split(":")[0];
  return type === "execution" || LOGBOOK_OPERATIONS.has(type);
}

/**
 * Refuses what the actor may not do and returns the operation to apply (a personal packing item
 * is always stamped with its writer).
 * @param activeMemberIds members an item may be assigned to or a cost split between
 */
export function authorizeOperation(
  operation: PlanOperation,
  state: PlanState,
  actor: Actor,
  activeMemberIds: ReadonlySet<string>
): PlanOperation {
  if (!actor.isOwner) {
    if (LOGBOOK_OPERATIONS.has(operation.type)) throw ownerOnly();
    if (operation.type === "execution") {
      const item = state.items.find((i) => i.id === operation.id);
      if (operation.execution === "confirmed" || item?.execution === "confirmed") throw ownerOnly();
    }
    if (
      operation.type === "settings" &&
      operation.values.ai !== undefined &&
      canonical(operation.values.ai) !== canonical(state.ai)
    )
      throw ownerOnly();
  }
  if (operation.type === "upsert" && operation.collection === "packing") {
    const existing = state.packing.find((p) => p.id === operation.value.id);
    if (existing && existing.scope === "personal" && !isMine(existing, actor)) throw notFound();
    const value = { ...operation.value };
    if (value.scope === "personal") value.ownerMemberId = actor.memberId;
    else {
      // A client that predates members sends no key: keep who brings it.
      if (!("ownerMemberId" in value)) value.ownerMemberId = existing?.ownerMemberId ?? null;
      const brings = value.ownerMemberId;
      if (brings !== null && (typeof brings !== "string" || !activeMemberIds.has(brings)))
        throw unknownMember();
    }
    return { ...operation, value };
  }
  if (operation.type === "remove" && operation.collection === "packing") {
    const existing = state.packing.find((p) => p.id === operation.id);
    if (existing && existing.scope === "personal" && !isMine(existing, actor)) throw notFound();
  }
  if (operation.type === "upsert" && operation.collection === "costs") {
    const split = operation.value.splitMemberIds;
    if (Array.isArray(split) && !split.every((id) => activeMemberIds.has(String(id))))
      throw unknownMember();
  }
  return operation;
}

/** Sets (or, for empty text, clears) the actor's own note. */
export function applyMemberNote(state: PlanState, memberId: string, text: string): PlanState {
  const others = state.memberNotes.filter((n) => n.memberId !== memberId);
  return { ...state, memberNotes: text.trim() ? [...others, { memberId, text }] : others };
}
