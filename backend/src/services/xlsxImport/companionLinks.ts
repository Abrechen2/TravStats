import { prisma } from "../../db";
import { linkRowsFor, resolveCompanions } from "../companionService";

/**
 * Companions from a spreadsheet cell, written the way every form writes them:
 * the legacy `companions` name list AND the `…Companion` link rows, in one
 * transaction with the record's own update.
 *
 * The cruise importer used to write the name list alone. The companion pages,
 * the companion statistics and the export read the LINKS, so a companion typed
 * into the sheet appeared on the cruise's card and nowhere else — the dual
 * write the form keeps (`routes/cruises.ts`), broken on the one other write
 * path. Names are resolved through `resolveCompanions`, which finds or creates
 * the account's companion, so "anna" and "Anna" stay one person.
 */

export interface ResolvedCompanionCell {
  ids: string[];
  /** The companions' display names, as the form stores them. */
  names: string[];
}

/** `undefined` for an empty cell: an untouched column never clears anyone. */
export async function resolveCompanionCell(
  userId: string,
  names: string[] | undefined
): Promise<ResolvedCompanionCell | undefined> {
  if (names === undefined) return undefined;
  const resolved = await resolveCompanions(userId, names);
  return { ids: resolved.map((c) => c.id), names: resolved.map((c) => c.displayName) };
}

type Owner = "flight" | "cruise";

/**
 * Writes the record's update and, when the cell carried companions, replaces
 * its link rows — both or neither.
 */
export async function updateWithCompanions(
  owner: Owner,
  id: string,
  data: Record<string, unknown>,
  companions: ResolvedCompanionCell | undefined
): Promise<void> {
  const payload = companions ? { ...data, companions: companions.names } : data;
  await prisma.$transaction(async (tx) => {
    if (owner === "flight") {
      if (Object.keys(payload).length > 0) await tx.flight.update({ where: { id }, data: payload });
      if (!companions) return;
      await tx.flightCompanion.deleteMany({ where: { flightId: id } });
      if (companions.ids.length > 0) {
        await tx.flightCompanion.createMany({
          data: linkRowsFor(companions.ids).map((row) => ({ ...row, flightId: id })),
          skipDuplicates: true,
        });
      }
      return;
    }
    if (Object.keys(payload).length > 0) await tx.cruise.update({ where: { id }, data: payload });
    if (!companions) return;
    await tx.cruiseCompanion.deleteMany({ where: { cruiseId: id } });
    if (companions.ids.length > 0) {
      await tx.cruiseCompanion.createMany({
        data: linkRowsFor(companions.ids).map((row) => ({ ...row, cruiseId: id })),
        skipDuplicates: true,
      });
    }
  });
}

/** Whether the cell's names differ from the stored list, compared as the form stores them. */
export function companionsDiffer(
  names: string[] | undefined,
  stored: { companions?: string[] | null }
): boolean {
  if (names === undefined) return false;
  const now = stored.companions ?? [];
  return names.length !== now.length || names.some((n, i) => n !== now[i]);
}
