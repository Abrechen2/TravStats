import type { DbTransaction } from "../../db";
import { ENTRY_FK } from "../photoLinking/entryKinds";
import { pairStops } from "../photoLinking/cruiseStopCarry";

/**
 * What a duplicate merge must carry over before it deletes the twins: the
 * `entry_photo_links` (manual picks and refusals) and the per-traveller facts
 * of the stay. Both hang off the twin with ON DELETE CASCADE, so without this
 * the delete silently takes them (defect class 4: a re-derivation must not
 * destroy good data).
 */

type PhotoKind = "flight" | "stay";
const rank = (l: { provenance: string; refused: boolean }): number =>
  l.refused ? 2 : l.provenance === "manual" ? 3 : 1;

/**
 * Move the twins' photo links onto the kept entry. A photo both hold (same
 * provider + asset) keeps ONE row: a manual pick beats a refusal beats an
 * automatic link, so neither a pick nor a refusal is lost to an auto row.
 */
export function carryPhotoLinks(
  tx: DbTransaction,
  kind: PhotoKind,
  keptId: string,
  removedIds: readonly string[]
): Promise<void> {
  return carryLinksOnto(tx, ENTRY_FK[kind], keptId, removedIds);
}

async function carryLinksOnto(
  tx: DbTransaction,
  fk: (typeof ENTRY_FK)[keyof typeof ENTRY_FK],
  keptId: string,
  removedIds: readonly string[]
): Promise<void> {
  const twins = await tx.entryPhotoLink.findMany({ where: { [fk]: { in: [...removedIds] } } });
  if (twins.length === 0) return;
  const held = new Map(
    (await tx.entryPhotoLink.findMany({ where: { [fk]: keptId } })).map((l) => [
      `${l.provider}|${l.assetId}`,
      l,
    ])
  );
  for (const twin of twins) {
    const key = `${twin.provider}|${twin.assetId}`;
    const mine = held.get(key);
    if (mine) {
      if (rank(twin) > rank(mine)) {
        const next = await tx.entryPhotoLink.update({
          where: { id: mine.id },
          data: { provenance: twin.provenance, refused: twin.refused },
        });
        held.set(key, next);
      }
      continue;
    }
    const moved = await tx.entryPhotoLink.update({
      where: { id: twin.id },
      data: { [fk]: keptId },
    });
    held.set(key, moved);
  }
}

/**
 * A cruise's photo links hang off its stops, which go with the removed copy.
 * A stop on the same day and port as one of the kept cruise's stops hands its
 * links over to it; a stop the kept itinerary does not have goes (and its
 * links with it), as the itinerary itself does.
 */
export async function carryCruiseStopLinks(
  tx: DbTransaction,
  keptId: string,
  removedIds: readonly string[]
): Promise<void> {
  const select = {
    id: true,
    dayNumber: true,
    isAtSea: true,
    portId: true,
    unresolvedPortName: true,
  } as const;
  const keptStops = await tx.cruiseStop.findMany({ where: { cruiseId: keptId }, select });
  if (keptStops.length === 0) return;
  // Each removed cruise is paired on its own: pairing hands out every kept
  // stop once, so two twins with one itinerary would otherwise share it.
  for (const removedId of removedIds) {
    const removedStops = await tx.cruiseStop.findMany({ where: { cruiseId: removedId }, select });
    for (const [from, onto] of pairStops(removedStops, keptStops)) {
      await carryLinksOnto(tx, "cruiseStopId", onto, [from]);
    }
  }
}

const STAY_FACTS = ["bookingReference", "loyaltyNumber", "factsSource"] as const;

/**
 * A stay's per-person facts: a person on both keeps the kept row's value and
 * takes what it lacks from the twin; a person only on a twin moves over (D7).
 */
export async function carryStayCompanionFacts(
  tx: DbTransaction,
  keptId: string,
  removedIds: readonly string[]
): Promise<void> {
  const twins = await tx.lodgingStayCompanion.findMany({
    where: { lodgingStayId: { in: [...removedIds] } },
  });
  for (const twin of twins) {
    const mine = await tx.lodgingStayCompanion.findUnique({
      where: {
        lodgingStayId_companionId: { lodgingStayId: keptId, companionId: twin.companionId },
      },
    });
    if (!mine) {
      await tx.lodgingStayCompanion.update({
        where: {
          lodgingStayId_companionId: {
            lodgingStayId: twin.lodgingStayId,
            companionId: twin.companionId,
          },
        },
        data: { lodgingStayId: keptId },
      });
      continue;
    }
    const fill = Object.fromEntries(
      STAY_FACTS.filter((k) => mine[k] == null && twin[k] != null).map((k) => [k, twin[k]])
    );
    if (Object.keys(fill).length > 0) {
      await tx.lodgingStayCompanion.update({
        where: {
          lodgingStayId_companionId: { lodgingStayId: keptId, companionId: twin.companionId },
        },
        data: fill,
      });
    }
  }
}
