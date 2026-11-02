import { linkRowsFor } from "../companionService";

/**
 * The per-domain `…Companion` join delegates (`railJourneyCompanion`, …)
 * differ only in the name of their parent column, so the writes are shared
 * and the column is passed in (forgejo#382).
 */
type LinkRow<Column extends string> = { companionId: string; position: number } & Record<
  Column,
  string
>;

interface CompanionLinkDelegate<Column extends string> {
  deleteMany(args: { where: Record<Column, string> }): Promise<unknown>;
  createMany(args: { data: LinkRow<Column>[]; skipDuplicates: true }): Promise<unknown>;
}

/** Inserts the ordered links for a new parent row. No-op for an empty list. */
export async function linkCompanions<Column extends string>(
  delegate: CompanionLinkDelegate<Column>,
  parentColumn: Column,
  parentId: string,
  companions: ReadonlyArray<{ id: string }>
): Promise<void> {
  if (companions.length === 0) return;
  await delegate.createMany({
    data: linkRowsFor(companions.map((c) => c.id)).map((row) => ({
      ...row,
      [parentColumn]: parentId,
    })) as LinkRow<Column>[],
    skipDuplicates: true,
  });
}

/** Replaces every link of an existing parent row with the given ordered list. */
export async function replaceCompanionLinks<Column extends string>(
  delegate: CompanionLinkDelegate<Column>,
  parentColumn: Column,
  parentId: string,
  companions: ReadonlyArray<{ id: string }>
): Promise<void> {
  await delegate.deleteMany({ where: { [parentColumn]: parentId } as Record<Column, string> });
  await linkCompanions(delegate, parentColumn, parentId, companions);
}
