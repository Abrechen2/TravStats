import type { Prisma } from "../../prisma";

/**
 * Where a train ride came from — "aus einer Sparpreis-Mail" (forgejo#132
 * item 17, owner 2026-10-01): READ from the originals filed with the ride,
 * never a column a client sets. A ride parsed from a ticket mail carries that
 * mail as a linked document (`POST /rail` takes `documentIds`); a typed ride,
 * or one whose original was not kept, has none, and its source is null — not
 * "manual", which nobody stated.
 *
 * When several originals are filed, the one the parser read wins over one
 * uploaded later (a receipt added afterwards is evidence, not the source), and
 * among equals the oldest; `documentCount` says how many there are.
 */

export interface RailSource {
  kind: "document";
  documentId: string;
  /** What the document is: invoice | booking | boardingPass | ticket | other; null if unstated. */
  documentKind: string | null;
  /** The file: image | pdf | eml | emailText | pkpass. */
  format: string;
  /** The file name the user handed over, sanitised; null when none was sent. */
  name: string | null;
  /** The date printed on the document, `YYYY-MM-DD`; null when unknown. */
  issuedOn: string | null;
  /** True when the ride was parsed from this document rather than filed with it later. */
  parsed: boolean;
  /** How many originals are filed with the ride. */
  documentCount: number;
}

/** The include a ride read needs for `withRailSource`. */
export const RAIL_SOURCE_INCLUDE = {
  documents: {
    select: {
      id: true,
      kind: true,
      format: true,
      originalName: true,
      issuedOn: true,
      source: true,
    },
    // "parse" sorts before "upload", so ascending puts a parsed original first.
    orderBy: [{ source: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: 1,
  },
  _count: { select: { documents: true } },
} satisfies Prisma.RailJourneyInclude;

interface SourceRefs {
  documents: Array<{
    id: string;
    kind: string | null;
    format: string;
    originalName: string | null;
    issuedOn: Date | null;
    source: string;
  }>;
  _count: { documents: number };
}

/** The ride without the raw include, with `source` in its place. */
export function withRailSource<T extends SourceRefs>(
  ride: T
): Omit<T, "documents" | "_count"> & { source: RailSource | null } {
  const { documents, _count, ...rest } = ride;
  const first = documents[0];
  return {
    ...rest,
    source: first
      ? {
          kind: "document",
          documentId: first.id,
          documentKind: first.kind,
          format: first.format,
          name: first.originalName,
          // A @db.Date column: the day itself, carried at UTC midnight.
          issuedOn: first.issuedOn ? first.issuedOn.toISOString().slice(0, 10) : null,
          parsed: first.source === "parse",
          documentCount: _count.documents,
        }
      : null,
  };
}
