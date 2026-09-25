/**
 * Resolving a reference cell ("Name [id]") to a record of THIS account.
 *
 * The order is the whole design:
 *
 *   1. The bracketed id, if it is the caller's own → that record. This is the
 *      ordinary round trip inside one account.
 *   2. The bracketed id, if this run already placed the row the file called
 *      by that id (created or matched it) → where it went. This is the
 *      account move: A's id never touches A's record, it only links rows that
 *      travel together in the file.
 *   3. The readable half — the name — against this account's records and the
 *      rows this run created. Exactly one match → that record. This is the
 *      file whose ids were deleted by hand, which is what the tester did.
 *
 * A foreign id falls through 1 without a trace: the lookup is scoped by
 * `userId`, so the answer for "someone else's" and "does not exist" is the
 * same miss, and the stranger's record is never read.
 */

import { prisma } from "../../db";
import { type Ctx, type ParentKind, isPending, labelForms, norm, dayOf } from "./context";
import * as cell from "./cells";

export type ParentResolution = { id: string } | { error: string };

/** The readable half of a reference cell: everything before " [id]". */
export function refName(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const name = v.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
  return name || undefined;
}

async function ownsParent(kind: ParentKind, id: string, userId: string): Promise<boolean> {
  const where = { id, userId };
  const select = { id: true } as const;
  if (kind === "cruise") return Boolean(await prisma.cruise.findFirst({ where, select }));
  if (kind === "lodging") return Boolean(await prisma.lodging.findFirst({ where, select }));
  return Boolean(await prisma.place.findFirst({ where, select }));
}

/**
 * Every label form of this account's parents of one kind.
 *
 * Read once per kind per lookup rather than cached across the run: the
 * parent sheet may have created rows since, and a stale cache would be
 * exactly the "created it, then could not find it" bug.
 */
async function storedLabels(kind: ParentKind, userId: string): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const add = (id: string, forms: string[]) => {
    for (const f of forms) {
      const set = out.get(f) ?? new Set<string>();
      set.add(id);
      out.set(f, set);
    }
  };
  if (kind === "place") {
    const rows = await prisma.place.findMany({
      where: { userId },
      select: { id: true, name: true, city: true },
    });
    for (const r of rows) add(r.id, labelForms(r.name, r.city));
  } else if (kind === "lodging") {
    const rows = await prisma.lodging.findMany({
      where: { userId },
      select: { id: true, name: true, city: true },
    });
    for (const r of rows) add(r.id, labelForms(r.name, r.city));
  } else {
    const rows = await prisma.cruise.findMany({
      where: { userId },
      select: {
        id: true,
        routeName: true,
        shipNameOverride: true,
        cruiseLine: true,
        startDate: true,
        ship: { select: { name: true } },
      },
    });
    for (const r of rows) {
      add(r.id, labelForms(cruiseLabelBase(r), dayOf(r.startDate)));
    }
  }
  return out;
}

/** Mirrors `cruiseLabel` in the frontend export. */
export function cruiseLabelBase(c: {
  routeName?: string | null;
  shipNameOverride?: string | null;
  ship?: { name: string } | null;
  cruiseLine?: string | null;
}): string | null {
  return c.routeName ?? c.shipNameOverride ?? c.ship?.name ?? c.cruiseLine ?? null;
}

export async function resolveParent(
  kind: ParentKind,
  raw: string | undefined,
  ctx: Ctx
): Promise<ParentResolution> {
  const fileId = cell.ref(raw);
  const name = refName(raw);
  if (!fileId && !name) return { error: `${kind}_missing` };

  if (fileId && !isPending(fileId) && (await ownsParent(kind, fileId, ctx.userId))) {
    return { id: fileId };
  }
  const placed = fileId ? ctx.byFileId[kind].get(fileId) : undefined;
  if (placed) return { id: placed };

  if (!name) return { error: `unknown_${kind}` };
  const wanted = norm(name);
  const stored = await storedLabels(kind, ctx.userId);
  const hits = new Set<string>([
    ...(stored.get(wanted) ?? []),
    ...(ctx.byLabel[kind].get(wanted) ?? []),
  ]);
  if (hits.size === 1) return { id: [...hits][0] };
  return { error: hits.size === 0 ? `unknown_${kind}` : `ambiguous_${kind}` };
}

/**
 * A trip reference on a flight or cruise row.
 *
 * Trips are not a sheet of the workbook, so there is no row to follow — only
 * the caller's own trip by id, or by its name when exactly one has it. Anything
 * else leaves the entry unlinked and says so (`trip_not_linked`) rather than
 * refusing the row: losing the link is recoverable in two clicks, losing the
 * flight is not.
 */
export async function resolveTrip(
  raw: string | undefined,
  userId: string
): Promise<{ tripId?: string; note?: string }> {
  const id = cell.ref(raw);
  const name = refName(raw);
  if (!id && !name) return {};
  if (id) {
    const own = await prisma.trip.findFirst({ where: { id, userId }, select: { id: true } });
    if (own) return { tripId: own.id };
  }
  if (name) {
    const byName = await prisma.trip.findMany({
      where: { userId, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
      take: 2,
    });
    if (byName.length === 1) return { tripId: byName[0].id };
  }
  return { note: "trip_not_linked" };
}

/** A catalogue port by name — the sheet carries names, not ids. */
export async function findPortId(name: string | undefined): Promise<number | null> {
  if (!name) return null;
  const port = await prisma.port.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  return port?.id ?? null;
}

export async function findShipId(name: string | undefined): Promise<number | null> {
  if (!name) return null;
  const ship = await prisma.ship.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  return ship?.id ?? null;
}

/** An existing chain by name. Never creates one — the catalogue does not grow
 *  behind the user's back from a spreadsheet, same rule as the CSV import. */
export async function findChainId(name: string | undefined): Promise<number | null> {
  if (!name) return null;
  const chain = await prisma.lodgingChain.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  return chain?.id ?? null;
}
