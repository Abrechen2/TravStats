import type { EvidenceEntry } from "../../schemas/evidence";

export interface PagingParams {
  offset: number;
  limit: number;
}

function compareId(a: EvidenceEntry, b: EvidenceEntry): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * The stable order evidence pages rely on: date DESCENDING, then id
 * ASCENDING as the tie-breaker, with undated rows LAST — not sorted as
 * epoch zero. An undated stay is not a stay from 1970; putting it first
 * would be the same lie `shared/lodgingTiming.ts` already refuses for
 * nights. Sort BEFORE slicing (`sliceEntries`), because a page boundary
 * that reorders drops or repeats a row.
 */
export function sortEntries(entries: EvidenceEntry[]): EvidenceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.date === null && b.date === null) return compareId(a, b);
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    if (a.date.value !== b.date.value) return a.date.value < b.date.value ? 1 : -1;
    return compareId(a, b);
  });
}

/** Bounds the WORK returned, not the scan — applied after `sortEntries`, never before. */
export function sliceEntries(
  entries: EvidenceEntry[],
  { offset, limit }: PagingParams
): EvidenceEntry[] {
  return entries.slice(offset, offset + limit);
}
