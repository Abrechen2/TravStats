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
  deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
  findMany(args: {
    where: Record<string, unknown>;
    select: { companionId: true };
  }): Promise<Array<{ companionId: string }>>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: { position: number };
  }): Promise<unknown>;
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

/**
 * Makes an existing parent row's links exactly the given ordered list. A
 * person who stays keeps their row — and the per-traveller facts on it (D7);
 * deleting and re-creating every row would wipe a seat on any re-sent list.
 */
export async function replaceCompanionLinks<Column extends string>(
  delegate: CompanionLinkDelegate<Column>,
  parentColumn: Column,
  parentId: string,
  companions: ReadonlyArray<{ id: string }>
): Promise<void> {
  const ids = companions.map((c) => c.id);
  await delegate.deleteMany({ where: { [parentColumn]: parentId, companionId: { notIn: ids } } });
  const have = new Set(
    (
      await delegate.findMany({
        where: { [parentColumn]: parentId },
        select: { companionId: true },
      })
    ).map((r) => r.companionId)
  );
  for (const [position, id] of ids.entries()) {
    if (have.has(id)) {
      await delegate.updateMany({
        where: { [parentColumn]: parentId, companionId: id },
        data: { position },
      });
    } else {
      await delegate.createMany({
        data: [{ companionId: id, position, [parentColumn]: parentId }] as LinkRow<Column>[],
        skipDuplicates: true,
      });
    }
  }
}
