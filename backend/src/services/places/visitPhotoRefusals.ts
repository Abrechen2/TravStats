import { prisma } from "../../db";
import { refusalKey } from "../photoLinking/matcher";
import type { PhotoSourceKind } from "../photoSource";
import { toPhotoSourceKind } from "../photoSource/connection";

/**
 * "Nicht diese" on a visit's photo suggestion (forgejo#132 item 13), kept by
 * the server so the suggestion does not come back — on the next opening, on
 * another device, or in the web. It lived on the phone alone before.
 *
 * Per VISIT: the same picture may well belong to another visit that day. A
 * refusal only ever removes a suggestion from the caller's own list, so a
 * library id is stored as given (it cannot be proven after the search cache's
 * minute, and refusing a picture needs no proof); a trip photo id must be one
 * of the caller's photos — a foreign key would prove it exists, not whose it
 * is — and anything else is skipped and counted, like a link.
 */

export interface RefusalPicks {
  tripPhotoIds: string[];
  assetIds: string[];
  /** Source of `assetIds`; Immich when absent. */
  provider?: PhotoSourceKind;
}

export interface RefusedIds {
  trip: Set<string>;
  /** `provider:assetId` keys (`refusalKey`), because an id is only unique per source. */
  library: Set<string>;
}

async function ownsVisit(userId: string, visitId: string): Promise<boolean> {
  const visit = await prisma.placeVisit.findFirst({
    where: { id: visitId, userId },
    select: { id: true },
  });
  return visit !== null;
}

/** Null when the visit is not the caller's. Idempotent: a repeat refuses nothing new. */
export async function refusePhotoSuggestions(
  userId: string,
  visitId: string,
  picks: RefusalPicks
): Promise<{ refused: number; skipped: number } | null> {
  if (!(await ownsVisit(userId, visitId))) return null;
  const owned = await prisma.tripPhoto.findMany({
    where: { id: { in: picks.tripPhotoIds }, trip: { userId } },
    select: { id: true },
  });
  const rows = [
    ...owned.map((p) => ({ kind: "trip", suggestionId: p.id })),
    ...picks.assetIds.map((id) => ({
      kind: "library",
      provider: picks.provider ?? "immich",
      suggestionId: id,
    })),
  ];
  const { count } = await prisma.visitPhotoRefusal.createMany({
    data: rows.map((row) => ({ ...row, userId, placeVisitId: visitId })),
    skipDuplicates: true,
  });
  return { refused: count, skipped: picks.tripPhotoIds.length - owned.length };
}

/** Undo every refusal of the visit — "show the refused ones again". Null when not the caller's. */
export async function clearPhotoRefusals(
  userId: string,
  visitId: string
): Promise<{ cleared: number } | null> {
  if (!(await ownsVisit(userId, visitId))) return null;
  const { count } = await prisma.visitPhotoRefusal.deleteMany({
    where: { placeVisitId: visitId, userId },
  });
  return { cleared: count };
}

/** The visit's refused suggestions, by kind. */
export async function refusedIds(visitId: string): Promise<RefusedIds> {
  const rows = await prisma.visitPhotoRefusal.findMany({
    where: { placeVisitId: visitId },
    select: { kind: true, provider: true, suggestionId: true },
  });
  return {
    trip: new Set(rows.filter((r) => r.kind === "trip").map((r) => r.suggestionId)),
    library: new Set(
      rows
        .filter((r) => r.kind === "library")
        .map((r) => refusalKey(toPhotoSourceKind(r.provider), r.suggestionId))
    ),
  };
}
