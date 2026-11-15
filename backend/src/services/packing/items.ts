/**
 * The packing list's items and who may see them (forgejo#398, single store).
 *
 * Pure: the callers resolve who is acting and what the trip's owner is. A
 * member sees the shared items plus their own personal ones; owning the trip
 * reveals nobody else's personal items.
 */
import { AppError } from "../../middleware/errorHandler";
import {
  PACKING_MAX_LABEL,
  type PackingItem,
  type PackingPrincipal,
  type RichPackingItem,
} from "../../schemas/companionData";

/** The server name an account on THIS server carries in a principal. */
export const LOCAL_SERVER = "local";

export const sameServerAccount = (userId: string): PackingPrincipal => ({
  server: LOCAL_SERVER,
  subjectId: userId,
});

export const samePrincipal = (a: PackingPrincipal | null, b: PackingPrincipal | null): boolean =>
  a === b || (!!a && !!b && a.server === b.server && a.subjectId === b.subjectId);

export const actorKey = (p: PackingPrincipal): string => `${p.server}:${p.subjectId}`;

/** Who acts on the list: their principal, and whether they own the trip. */
export interface PackingViewer {
  principal: PackingPrincipal;
  isTripOwner: boolean;
}

/** A stored row, read with the defaults a row written before rich items lacks. */
export function normalizeItem(raw: unknown): RichPackingItem {
  const r = (raw ?? {}) as Partial<RichPackingItem> & { packed?: boolean };
  return {
    id: String(r.id),
    label: String(r.label ?? "").slice(0, PACKING_MAX_LABEL),
    done: Boolean(r.done ?? r.packed ?? false),
    category: r.category ?? "",
    quantity: r.quantity ?? 1,
    scope: r.scope === "shared" ? "shared" : "personal",
    note: r.note ?? "",
    manual: r.manual ?? true,
    ownerPrincipal: r.ownerPrincipal ?? null,
    assigneePrincipal: r.assigneePrincipal ?? null,
  };
}

export const normalizeItems = (stored: unknown): RichPackingItem[] =>
  Array.isArray(stored) ? stored.map(normalizeItem) : [];

/** Is this item the viewer's to see: shared, or personal and theirs. */
export function isVisible(item: RichPackingItem, viewer: PackingViewer): boolean {
  if (item.scope === "shared") return true;
  if (item.ownerPrincipal === null) return viewer.isTripOwner;
  return samePrincipal(item.ownerPrincipal, viewer.principal);
}

export const projectFor = (items: readonly RichPackingItem[], viewer: PackingViewer) =>
  items.filter((item) => isVisible(item, viewer));

/**
 * The owner's own personal items carry a null owner (as every item did before
 * members); anything else keeps its principal.
 */
export function canonicalOwner(
  principal: PackingPrincipal | null,
  viewer: Pick<PackingViewer, "principal" | "isTripOwner">
): PackingPrincipal | null {
  if (principal === null) return null;
  return viewer.isTripOwner && samePrincipal(principal, viewer.principal) ? null : principal;
}

export const toLegacy = (item: RichPackingItem): PackingItem => ({
  id: item.id,
  label: item.label,
  done: item.done,
});

const idConflict = () =>
  new AppError("An item id is already used by another member", 409, "PACKING_ID_CONFLICT");

/**
 * Applies a write that replaces what the caller sees. An id missing from
 * `incoming` is deleted only when it was visible; hidden items are untouched
 * and an incoming id that collides with one is refused.
 *
 * @param merge  Legacy write: label and done update, every other field of an
 *               existing item is kept, and a new id is the viewer's personal item.
 *               Rich write: the incoming item replaces the stored one.
 */
export function replaceVisible(
  stored: readonly RichPackingItem[],
  incoming: readonly (PackingItem | RichPackingItem)[],
  viewer: PackingViewer,
  merge: "legacy" | "rich"
): RichPackingItem[] {
  const byId = new Map(stored.map((item) => [item.id, item]));
  const next: RichPackingItem[] = [];
  const placed = new Set<string>();
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  for (const item of incoming) {
    const existing = byId.get(item.id);
    if (existing && !isVisible(existing, viewer)) throw idConflict();
  }
  // Keep the stored order; a hidden item stays exactly where it was.
  for (const item of stored) {
    if (!isVisible(item, viewer)) {
      next.push(item);
      continue;
    }
    const written = incomingById.get(item.id);
    if (!written) continue;
    next.push(apply(item, written, viewer, merge));
    placed.add(item.id);
  }
  for (const item of incoming)
    if (!placed.has(item.id)) next.push(apply(undefined, item, viewer, merge));
  return next;
}

function apply(
  existing: RichPackingItem | undefined,
  written: PackingItem | RichPackingItem,
  viewer: PackingViewer,
  merge: "legacy" | "rich"
): RichPackingItem {
  if (merge === "legacy" || !("scope" in written)) {
    return existing
      ? { ...existing, label: written.label, done: written.done }
      : {
          ...normalizeItem({ id: written.id, label: written.label, done: written.done }),
          ownerPrincipal: canonicalOwner(viewer.principal, viewer),
        };
  }
  const rich = written as RichPackingItem;
  return {
    ...rich,
    // A personal item written here is the writer's own; scope changes happen here only.
    ownerPrincipal: rich.scope === "personal" ? canonicalOwner(viewer.principal, viewer) : null,
    assigneePrincipal: rich.scope === "shared" ? rich.assigneePrincipal : null,
  };
}
