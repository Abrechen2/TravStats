import { prisma } from "../../db";

/**
 * How many documents hang off each visit, in ONE grouped query for all of
 * them — the place page shows the figure on every row of its visit list, and
 * asking per visit would be one request per row (the page used to mount a
 * documents section, and with it a fetch, for every visit).
 *
 * Only the caller's own documents are counted. A visit without documents is
 * absent from the grouped rows and answers 0 here: "no documents" is a known
 * zero, not an unknown.
 */
export async function visitDocumentCounts(
  userId: string,
  visitIds: readonly string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>(visitIds.map((id) => [id, 0]));
  if (visitIds.length === 0) return counts;
  const rows = await prisma.document.groupBy({
    by: ["placeVisitId"],
    where: { userId, placeVisitId: { in: [...visitIds] } },
    _count: { _all: true },
  });
  for (const row of rows) {
    if (row.placeVisitId) counts.set(row.placeVisitId, row._count._all);
  }
  return counts;
}
