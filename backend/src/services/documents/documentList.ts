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
  page: { limit: number; offset: number }
): Promise<{ documents: Array<{ document: Document; linkCount: number }>; total: number }> {
  const [documents, total] = await Promise.all([
    prisma.document.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: page.offset,
      take: page.limit,
      include: { _count: { select: { links: true } } },
    }),
    prisma.document.count({ where: { userId } }),
  ]);
  // Paged over DOCUMENTS, never link rows: a document linked to six entries is one row.
  return {
    documents: documents.map(({ _count, ...document }) => ({
      document,
      linkCount: _count.links,
    })),
    total,
  };
}
