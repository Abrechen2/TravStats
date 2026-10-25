/**
 * Never self-evidence (TravTrack plan E4; review focus 22). An entry made by
 * accepting a finding names the finding's evidence key (`suggestion_ref` on a
 * place visit; E6/E7 add `location_suggestions.accepted_entry_*`). Such an
 * entry is the answer to that finding — reached again through the replay —
 * and never counts as cover or support of the same key. An entry made from a
 * DIFFERENT finding still covers: two scans of one stop give one visit.
 */
import { prisma } from "../../db";

/** Whether `entry` was made by accepting the finding with `evidenceKey`. */
export function isOwnEntry(
  entry: { suggestionRef?: string | null },
  evidenceKey: string | null | undefined
): boolean {
  return !!evidenceKey && entry.suggestionRef === evidenceKey;
}

/** The entries this account made by accepting the finding with `evidenceKey`. */
export async function ownEntries(
  userId: string,
  evidenceKey: string
): Promise<Array<{ kind: "visit"; id: string }>> {
  const visits = await prisma.placeVisit.findMany({
    where: { userId, suggestionRef: evidenceKey },
    select: { id: true },
  });
  return visits.map((v) => ({ kind: "visit" as const, id: v.id }));
}
