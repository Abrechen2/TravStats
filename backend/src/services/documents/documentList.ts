import type { Document } from "../../prisma";

import { prisma } from "../../db";

/**
 * One page of every document the user owns — filed or not — oldest first, with
 * the total. Metadata only: the bytes stay behind `/documents/:id/file`. The
 * spreadsheet export walks it page by page, so an account with more than one
 * page of originals is exported whole instead of cut at the cap. `id` breaks the
 * tie because `createdAt` is not unique.
 */
export async function listOwnDocuments(
  userId: string,
  page: { limit: number; offset: number; companionId?: string }
): Promise<{
  documents: Array<{
    document: Document;
    linkCount: number;
    people: Array<{ id: string; displayName: string }>;
  }>;
  total: number;
}> {
  // Plan D7: "for Norbert" is a property of a link, so the filter is on links.
  const where = {
    userId,
    ...(page.companionId && { links: { some: { companionId: page.companionId } } }),
  };
  const [documents, total] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: page.offset,
      take: page.limit,
      include: {
        _count: { select: { links: true } },
        links: {
          where: { companionId: { not: null } },
          select: { companion: { select: { id: true, displayName: true } } },
        },
      },
    }),
    prisma.document.count({ where }),
  ]);
  // Paged over DOCUMENTS, never link rows: a document linked to six entries is one row.
  return {
    documents: documents.map(({ _count, links, ...document }) => ({
      document,
      linkCount: _count.links,
      people: [
        ...new Map(
          links.flatMap((l) => (l.companion ? [[l.companion.id, l.companion] as const] : []))
        ).values(),
      ],
    })),
    total,
  };
}
