import { prisma, type DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { canonicalizeCompanionName, searchableCompanionName } from "../../utils/companionName";
import { loadVisibleDomains } from "../domainVisibility";
import { PERSON_SELECT, toPerson, type SharePerson } from "../sharing/people";
import { rewriteCompanionArrays } from "./companionArrays";
import {
  COMPANION_JOINS,
  COMPANION_USE_KINDS,
  countJoinMoves,
  moveJoins,
  type CompanionJoinKind,
  type CompanionUseKind,
  type JoinMoveCount,
} from "./companionJoins";
import { daysTogether, loadTogether, visibleUseKinds } from "./companionTogether";
import { loadStayLinks } from "./companionStays";

/**
 * Settings → Mitreisende: the caller's companion catalogue, kept tidy by hand.
 * Three spellings of one person ("Norbert", "Norber", "Norbert Wittke") were
 * three rows with three sets of entries; rename and merge make them one.
 *
 * Every lookup is scoped to the caller — another account's companion answers
 * exactly like one that does not exist (404), so an id probe learns nothing.
 */

/** The `_count` relation behind each kind of entry linked through a join table. */
export const RELATION: Record<CompanionJoinKind, string> = {
  flight: "flights",
  trip: "trips",
  cruise: "cruises",
  rail: "rail",
  bus: "bus",
  ferry: "ferry",
  rental: "rentals",
};

export const COUNT_SELECT = {
  flights: true,
  trips: true,
  cruises: true,
  rail: true,
  bus: true,
  ferry: true,
  rentals: true,
  expensesPaid: true,
} as const;

/**
 * Entries per kind for one catalogue row: its join rows, and the stays that
 * name it (text only — `companionStays.ts`). Every kind, hidden ones included.
 */
export function usesOf(
  row: { id: string; _count: Record<string, number> },
  stays: ReadonlyMap<string, ReadonlySet<string>>
): Record<CompanionUseKind, number> {
  return Object.fromEntries(
    COMPANION_USE_KINDS.map((kind) => [
      kind,
      kind === "lodging" ? (stays.get(row.id)?.size ?? 0) : (row._count[RELATION[kind]] ?? 0),
    ])
  ) as Record<CompanionUseKind, number>;
}

export const notFound = () => new AppError("Companion not found", 404, "COMPANION_NOT_FOUND");

/** The one canonical spelling a typed name is stored in: trimmed, inner whitespace collapsed. */
export function cleanCompanionName(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export interface ManagedCompanion {
  id: string;
  name: string;
  linkedUser: SharePerson | null;
  /** Entries this companion is on, per kind the caller sees — planned ones included. */
  uses: Partial<Record<CompanionUseKind, number>>;
  /** Entries in domains the caller has switched off; they still block a delete. */
  hiddenUses: number;
  /** Expenses this companion paid — not travelling together, but a use. */
  expensesPaid: number;
  /** The last day spent together (`YYYY-MM-DD`, the entry's own clock), or null. */
  lastTogether: string | null;
  /** Anything that a delete would break: entries (stays naming them included), expenses or a link. */
  inUse: boolean;
}

export async function listManagedCompanions(
  userId: string
): Promise<{ companions: ManagedCompanion[]; kinds: CompanionUseKind[] }> {
  const visible = await loadVisibleDomains(userId);
  const kinds = visibleUseKinds(visible);
  const [rows, together] = await Promise.all([
    prisma.companion.findMany({
      where: { userId },
      include: { linkedUser: { select: PERSON_SELECT }, _count: { select: COUNT_SELECT } },
    }),
    loadTogether(userId, visible),
  ]);
  const stays = await loadStayLinks(prisma, userId, rows);
  const companions = rows.map((row) => {
    const uses = usesOf(row, stays.byCompanion);
    const of = (kind: CompanionUseKind) => uses[kind];
    const all = COMPANION_USE_KINDS.reduce((sum, kind) => sum + of(kind), 0);
    const shown = kinds.reduce((sum, kind) => sum + of(kind), 0);
    const days = daysTogether(together.byCompanion.get(row.id) ?? []);
    return {
      id: row.id,
      name: row.displayName,
      linkedUser: row.linkedUser ? toPerson(row.linkedUser) : null,
      uses: Object.fromEntries(kinds.map((kind) => [kind, of(kind)])),
      hiddenUses: all - shown,
      expensesPaid: row._count.expensesPaid,
      lastTogether: days.length > 0 ? days[days.length - 1] : null,
      inUse: all > 0 || row._count.expensesPaid > 0 || row.linkedUserId !== null,
    };
  });
  companions.sort((a, b) => a.name.localeCompare(b.name));
  return { companions, kinds };
}

async function ownCompanion(tx: DbTransaction, userId: string, id: string) {
  const row = await tx.companion.findFirst({
    where: { id, userId },
    include: { linkedUser: { select: PERSON_SELECT } },
  });
  if (!row) throw notFound();
  return row;
}

/**
 * Renames a companion and every list that names them. A rename onto a name
 * another companion already has is refused — that is a merge, and the answer
 * names the other companion so the page can offer exactly that.
 */
export async function renameCompanion(
  userId: string,
  id: string,
  rawName: string
): Promise<{ id: string; name: string }> {
  const name = cleanCompanionName(rawName);
  const canonical = canonicalizeCompanionName(name);
  return prisma.$transaction(
    async (tx) => {
      const companion = await ownCompanion(tx, userId, id);
      const other = await tx.companion.findFirst({
        where: { userId, canonicalName: canonical, NOT: { id } },
      });
      if (other) {
        throw new AppError(
          "Another companion already has that name",
          409,
          "COMPANION_NAME_TAKEN",
          "name",
          { companionId: other.id, companionName: other.displayName }
        );
      }
      await rewriteCompanionArrays(tx, userId, new Set([companion.canonicalName]), name);
      const updated = await tx.companion.update({
        where: { id },
        data: {
          canonicalName: canonical,
          displayName: name,
          searchName: searchableCompanionName(name),
        },
      });
      return { id: updated.id, name: updated.displayName };
    },
    { timeout: 30_000 }
  );
}

export type LinkOutcome =
  /** Neither is linked. */
  | "none"
  /** The target's link stays (the source had none). */
  | "keepTarget"
  /** Only the source was linked: the link moves to the target. */
  | "moveToTarget"
  /** Both linked to different accounts: refused, it would widen sharing silently. */
  | "conflict";

function linkOutcome(
  source: { linkedUserId: string | null },
  target: { linkedUserId: string | null }
): LinkOutcome {
  if (source.linkedUserId && target.linkedUserId) return "conflict";
  if (source.linkedUserId) return "moveToTarget";
  return target.linkedUserId ? "keepTarget" : "none";
}

export interface MergePreview {
  source: { id: string; name: string; linkedUser: SharePerson | null };
  target: { id: string; name: string; linkedUser: SharePerson | null };
  /** Per kind the caller sees: entries that move, and how many the target is on already. */
  entries: Partial<Record<CompanionUseKind, JoinMoveCount>>;
  /** Entries in domains switched off — they move too. */
  hiddenEntries: number;
  /** Expenses the source paid; the target becomes their payer. */
  expensesPaid: number;
  /** Entries whose list of names changes (spelling replaced, duplicate dropped). */
  renamedLists: number;
  link: LinkOutcome;
  /** False when the merge would be refused (`link === "conflict"`). */
  allowed: boolean;
}

async function preview(
  tx: DbTransaction,
  userId: string,
  sourceId: string,
  targetId: string
): Promise<MergePreview> {
  if (sourceId === targetId) {
    throw new AppError("A companion cannot be merged into itself", 400, "COMPANION_MERGE_SELF");
  }
  const [source, target, visible] = await Promise.all([
    ownCompanion(tx, userId, sourceId),
    ownCompanion(tx, userId, targetId),
    loadVisibleDomains(userId),
  ]);
  const kinds = visibleUseKinds(visible);
  const joinKinds = COMPANION_JOINS.map((j) => j.kind);
  const [moves, expensesPaid, lists] = await Promise.all([
    countJoinMoves(tx, source.id, target.id),
    tx.tripExpense.count({ where: { userId, payerCompanionId: source.id } }),
    rewriteCompanionArrays(tx, userId, new Set([source.canonicalName]), target.displayName, true),
  ]);
  const link = linkOutcome(source, target);
  const person = (c: typeof source) => ({
    id: c.id,
    name: c.displayName,
    linkedUser: c.linkedUser ? toPerson(c.linkedUser) : null,
  });
  return {
    source: person(source),
    target: person(target),
    // Stays carry no join row; their names are in `renamedLists`.
    entries: Object.fromEntries(
      joinKinds.filter((kind) => kinds.includes(kind)).map((kind) => [kind, moves[kind]])
    ),
    hiddenEntries: joinKinds
      .filter((k) => !kinds.includes(k))
      .reduce((sum, k) => sum + moves[k].entries, 0),
    expensesPaid,
    renamedLists: Object.values(lists).reduce((sum, n) => sum + n, 0),
    link,
    allowed: link !== "conflict",
  };
}

export function mergePreview(userId: string, sourceId: string, targetId: string) {
  return preview(prisma, userId, sourceId, targetId);
}

/**
 * Merges `source` into `target` in ONE transaction: links, expenses, name
 * lists, the account link — then the source row goes, and its delete reaches
 * the phone through the companions table's sync trigger. Each rewritten
 * entry's `updated_at` moves with its list, so the phone re-reads it too.
 */
export async function mergeCompanions(
  userId: string,
  sourceId: string,
  targetId: string
): Promise<MergePreview> {
  return prisma.$transaction(
    async (tx) => {
      const plan = await preview(tx, userId, sourceId, targetId);
      if (plan.link === "conflict") {
        throw new AppError(
          "Both companions are linked to different accounts",
          409,
          "COMPANION_MERGE_LINK_CONFLICT"
        );
      }
      const source = await tx.companion.findUniqueOrThrow({ where: { id: sourceId } });
      const target = await tx.companion.findUniqueOrThrow({ where: { id: targetId } });
      await moveJoins(tx, source.id, target.id);
      await tx.tripExpense.updateMany({
        where: { userId, payerCompanionId: source.id },
        data: { payerCompanionId: target.id },
      });
      await rewriteCompanionArrays(tx, userId, new Set([source.canonicalName]), target.displayName);
      // The source leaves first: an account can be linked to one companion
      // per owner only (`@@unique([userId, linkedUserId])`).
      await tx.companion.delete({ where: { id: source.id } });
      if (plan.link === "moveToTarget") {
        await tx.companion.update({
          where: { id: target.id },
          data: { linkedUserId: source.linkedUserId },
        });
      }
      return plan;
    },
    { timeout: 30_000 }
  );
}
