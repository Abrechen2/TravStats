import { prisma } from "../../db";
import { Prisma } from "../../prisma";

/** What the stay editor offers from the user's earlier stays. */
export interface StaySuggestions {
  /** Rooms the user had in THIS house — a room number means nothing elsewhere. */
  roomNumbers: string[];
  /** This house's categories first, then the chain's, then any. */
  roomCategories: string[];
  /** Board types in the same order; "none" is not a suggestion, it is the default. */
  boards: string[];
}

type StayField = "roomNumber" | "roomCategory" | "board";

const ROOM_NUMBER_CAP = 4;
const ROOM_CATEGORY_CAP = 6;
const BOARD_CAP = 3;
/** Rows read per group before the case-insensitive merge, which can only shrink the list. */
const OVERFETCH = 3;

/** Non-null and non-blank — an emptied input is stored as "" by some paths. */
function present(field: StayField): Prisma.LodgingStayWhereInput {
  return { AND: [{ [field]: { not: null } }, { NOT: { [field]: "" } }] };
}

/**
 * Distinct values of one stay column, most frequent first, then most recently
 * stayed. Grouped and bounded in the database; "Deluxe" and "deluxe" are one.
 */
async function rankedStayValues(
  field: StayField,
  where: Prisma.LodgingStayWhereInput,
  cap: number
): Promise<string[]> {
  // A column-generic groupBy defeats Prisma's result inference, so the row
  // shape is stated once here instead of cast at every read.
  const groups = (await prisma.lodgingStay.groupBy({
    by: [field],
    where: { AND: [where, present(field)] },
    _count: { [field]: true },
    _max: { checkIn: true },
    orderBy: [{ _count: { [field]: "desc" } }, { _max: { checkIn: "desc" } }],
    take: cap * OVERFETCH,
  })) as unknown as Array<{
    [key: string]: unknown;
    _count: Record<string, number>;
    _max: { checkIn: Date | null };
  }>;

  const merged = new Map<string, { value: string; count: number; last: number }>();
  for (const g of groups) {
    const value = (g[field] as string | null)?.trim() ?? "";
    if (!value) continue;
    const key = value.toLowerCase();
    const count = g._count[field] ?? 0;
    const last = g._max.checkIn?.getTime() ?? Number.NEGATIVE_INFINITY;
    const seen = merged.get(key);
    merged.set(
      key,
      seen
        ? { value: seen.value, count: seen.count + count, last: Math.max(seen.last, last) }
        : { value, count, last }
    );
  }
  return [...merged.values()]
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, cap)
    .map((entry) => entry.value);
}

/** Keeps the first spelling of each value — the best-ranked scope's. */
function dedupe(values: readonly string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length === cap) break;
  }
  return out;
}

/** Each scope's ranking in turn: this house, its chain, everything. */
async function scopedValues(
  field: StayField,
  scopes: readonly Prisma.LodgingStayWhereInput[],
  cap: number,
  extra: Prisma.LodgingStayWhereInput = {}
): Promise<string[]> {
  const lists = await Promise.all(
    scopes.map((scope) => rankedStayValues(field, { AND: [scope, extra] }, cap))
  );
  return dedupe(lists.flat(), cap);
}

/**
 * The stay editor's suggestions for `lodgingId`. A house that is not the
 * caller's is treated as unknown — only their overall history is offered — so
 * the answer says nothing about whether the id exists for someone else.
 */
export async function staySuggestionsFor(
  userId: string,
  lodgingId: string | undefined
): Promise<StaySuggestions> {
  const lodging = lodgingId
    ? await prisma.lodging.findFirst({
        where: { id: lodgingId, userId },
        select: { id: true, chainId: true },
      })
    : null;

  const scopes: Prisma.LodgingStayWhereInput[] = [
    ...(lodging ? [{ userId, lodgingId: lodging.id }] : []),
    ...(lodging?.chainId != null ? [{ userId, lodging: { chainId: lodging.chainId } }] : []),
    { userId },
  ];

  const [roomNumbers, roomCategories, boards] = await Promise.all([
    lodging
      ? rankedStayValues("roomNumber", { userId, lodgingId: lodging.id }, ROOM_NUMBER_CAP)
      : Promise.resolve([]),
    scopedValues("roomCategory", scopes, ROOM_CATEGORY_CAP),
    scopedValues("board", scopes, BOARD_CAP, { NOT: { board: "none" } }),
  ]);
  return { roomNumbers, roomCategories, boards };
}
