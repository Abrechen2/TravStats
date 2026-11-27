/**
 * "Automatisch eingetragen" (owner 2026-11-26): visits written without the owner's hand — a smart
 * list's auto-accept, an import marked `created_by = import`, a plugin — reviewed and taken back in
 * bulk. Undo removes only what automation wrote and nothing the owner added since: a smart-list
 * visit goes through the list's own undo (entry, place, finding), any other automatic visit is
 * deleted only while it carries no note, rating, photo, document or expense.
 */
import { prisma } from "../../db";
import { recheckAchievements } from "../../utils/achievements";
import { runUnfiltered } from "../provenance/recordedOnly";
import { BRAND_RULE, matchesOf, undoAutoAccepted } from "./brandRules";

/** A write and its bookkeeping land within this of each other; a later update is an edit. */
const EDIT_GRACE_MS = 5_000;
/** `created_by` values automation writes. */
export const AUTO_CREATED_BY = [BRAND_RULE, "import", "auto", "plugin"] as const;
/** `written_via` values that name automation (a plugin or a brand rule wrote the row). */
export const AUTO_WRITTEN_VIA = [BRAND_RULE, "plugin"] as const;

export function isAutomaticVisit(v: {
  createdBy: string | null;
  writtenVia: string | null;
}): boolean {
  return (
    (v.createdBy !== null && (AUTO_CREATED_BY as readonly string[]).includes(v.createdBy)) ||
    (v.writtenVia !== null && (AUTO_WRITTEN_VIA as readonly string[]).includes(v.writtenVia))
  );
}

export type AutoUndoOutcome =
  | { visitId: string; outcome: "removed" }
  | { visitId: string; outcome: "kept"; reason: "notFound" | "notAutomatic" | "ownerAdded" };

async function undoOne(userId: string, visitId: string): Promise<AutoUndoOutcome> {
  const visit = await prisma.placeVisit.findFirst({
    where: { id: visitId, userId },
    include: {
      _count: { select: { photos: true, documents: true, documentLinks: true, expenses: true } },
    },
  });
  if (!visit) return { visitId, outcome: "kept", reason: "notFound" };
  if (!isAutomaticVisit(visit)) return { visitId, outcome: "kept", reason: "notAutomatic" };

  // A smart list's automatic acceptance: its own undo also takes back the entry and the place.
  const stay = await prisma.dawarichStay.findFirst({
    where: { userId, visitId, status: "accepted", provider: "travtrack" },
    select: { id: true, evidence: true },
  });
  if (stay && matchesOf(stay.evidence).some((m) => m.auto)) {
    const result = await undoAutoAccepted(userId, stay.id);
    return result.removedVisit
      ? { visitId, outcome: "removed" }
      : {
          visitId,
          outcome: "kept",
          reason: result.keptVisit === "notAutomatic" ? "notAutomatic" : "ownerAdded",
        };
  }

  // An edit since it was written (date, trip, place) also makes the visit the owner's.
  const edited = visit.updatedAt.getTime() - visit.createdAt.getTime() > EDIT_GRACE_MS;
  const added =
    edited ||
    !!visit.notes ||
    visit.rating !== null ||
    Object.values(visit._count).some((n) => n > 0);
  if (added) return { visitId, outcome: "kept", reason: "ownerAdded" };
  await prisma.$transaction(async (tx) => {
    await tx.placeVisit.delete({ where: { id: visit.id } });
    // The last visit gone, the place is no longer "visited" (every visit counts, a hidden one too).
    const left = await runUnfiltered(
      async () => await tx.placeVisit.count({ where: { placeId: visit.placeId } })
    );
    if (left === 0)
      await tx.place.updateMany({
        where: { id: visit.placeId, userId, visited: true },
        data: { visited: false },
      });
  });
  return { visitId, outcome: "removed" };
}

/** Undo several automatic visits; each is answered on its own, one refusal never stops the rest. */
export async function undoAutomaticVisits(
  userId: string,
  visitIds: readonly string[]
): Promise<AutoUndoOutcome[]> {
  const out: AutoUndoOutcome[] = [];
  for (const id of new Set(visitIds)) out.push(await undoOne(userId, id));
  if (out.some((o) => o.outcome === "removed"))
    await recheckAchievements(userId, "Automatic place visits undone");
  return out;
}
