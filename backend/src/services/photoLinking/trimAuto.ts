import { prisma } from "../../db";
import { photoCapFor } from "./cap";
import { ENTRY_FK, ENTRY_KINDS } from "./entryKinds";
import { visitCandidateDistances } from "../places/visitPhotoChoices";
import { toPhotoSourceKind } from "../photoSource/connection";
import { findMatches, toKind } from "./entryPhotos";
import { directSearch, refusalKey, type SourceState, type WindowSearch } from "./matcher";
import { planFor, type EntryKind } from "./entryKinds";
import { pickSpread, type SpreadItem } from "./spread";

/**
 * The one-time (and after-a-lower-cap) pass that trims every visit's and
 * entry's AUTOMATIC links down to the account's cap (owner, 2026-11-21, after
 * 9,182 photos had been linked). It ranks with the same `pickSpread` as the
 * linker — spread over the time the photos cover, no near-duplicates.
 *
 * What it never touches: a user's own pick (provenance `manual`), a refusal,
 * and a visit or entry already within its cap. The user's picks count toward
 * the cap, so a visit with four picks and a cap of six keeps at most two
 * automatic links. Trimmed links are deleted, not refused — nobody removed
 * them, so a later pass may link a different photo if room opens up.
 *
 * Stored links carry no distance, so for each visit or entry over its cap the
 * pass asks the photo sources again and reads the distance off the matcher's
 * candidates — the ranking is distance plus spread, as for a new link. A holder
 * whose source failed to answer is skipped and counted (`skipped`), never
 * trimmed blind; a second run picks it up. Idempotent: a second run finds
 * nothing over the cap.
 */

export interface TrimResult {
  /** Visits and entries that held links over their cap. */
  trimmed: number;
  /** Visits and entries looked at. */
  checked: number;
  removed: number;
  /** Over the cap but not trimmed because a photo source did not answer; run again. */
  skipped: number;
}

interface LinkRow {
  id: string;
  /** `provider:assetId`, the key the matcher's candidates carry. */
  key: string;
  at: number;
  provenance: string;
}

/** The auto links to delete for one holder: all but the spread picks of what room is left. */
export function linksToTrim(
  rows: readonly LinkRow[],
  cap: number,
  distanceKm: ReadonlyMap<string, number> = new Map()
): string[] {
  const manual = rows.filter((r) => r.provenance !== "auto").length;
  const room = Math.max(0, cap - manual);
  const auto = rows.filter((r) => r.provenance === "auto");
  if (auto.length <= room) return [];
  // An undated link has no place on the time axis; it is the first to go.
  const dated: SpreadItem[] = auto
    .filter((r) => Number.isFinite(r.at))
    .map((r) => ({ key: r.id, at: r.at, distanceKm: distanceKm.get(r.key) ?? null }));
  const keep = new Set(pickSpread(dated, room).map((i) => i.key));
  return auto.filter((r) => !keep.has(r.id)).map((r) => r.id);
}

function group(rows: { holder: string; row: LinkRow }[]): Map<string, LinkRow[]> {
  const out = new Map<string, LinkRow[]>();
  for (const { holder, row } of rows) out.set(holder, [...(out.get(holder) ?? []), row]);
  return out;
}

const FAILED = (s: SourceState): boolean =>
  s !== "ok" && s !== "notConfigured" && s !== "truncated";

/** Km to the place per `provider:assetId` for an entry; null when a source failed to answer. */
async function entryDistances(
  userId: string,
  kind: EntryKind,
  id: string,
  search: WindowSearch
): Promise<Map<string, number> | null> {
  const plan = await planFor(userId, kind, id);
  if (plan === null || plan === "untimed") return new Map();
  const found = await findMatches(userId, kind, id, plan, search, "none");
  if (Object.values(found.sources).some(FAILED)) return null;
  return new Map(
    found.matched.flatMap((m) =>
      m.distanceKm === undefined
        ? []
        : [[refusalKey(m.provider, m.asset.id), m.distanceKm] as const]
    )
  );
}

export async function trimAutoLinks(
  userId: string,
  onProgress?: (done: number, total: number) => void,
  search: WindowSearch = directSearch(userId)
): Promise<TrimResult> {
  const cap = await photoCapFor(userId);
  const [visitRows, entryRows] = await Promise.all([
    prisma.placeVisitPhoto.findMany({
      where: { immichAssetId: { not: null }, visit: { userId } },
      select: {
        id: true,
        placeVisitId: true,
        takenAt: true,
        provenance: true,
        provider: true,
        immichAssetId: true,
      },
    }),
    prisma.entryPhotoLink.findMany({
      where: { userId, refused: false },
      select: {
        id: true,
        provenance: true,
        takenAt: true,
        provider: true,
        assetId: true,
        ...fkSelect(),
      },
    }),
  ]);
  const visitGroups = group(
    visitRows.map((r) => ({
      holder: r.placeVisitId,
      row: {
        id: r.id,
        key: refusalKey(toPhotoSourceKind(r.provider), r.immichAssetId!),
        at: r.takenAt?.getTime() ?? Number.NaN,
        provenance: r.provenance,
      },
    }))
  );
  const entryGroups = group(
    entryRows.flatMap((r) => {
      const kind = ENTRY_KINDS.find((k) => r[ENTRY_FK[k]] !== null);
      if (!kind) return [];
      return [
        {
          holder: `${kind}:${r[ENTRY_FK[kind]]}`,
          row: {
            id: r.id,
            key: refusalKey(toKind(r.provider), r.assetId),
            at: r.takenAt?.getTime() ?? Number.NaN,
            provenance: r.provenance,
          },
        },
      ];
    })
  );

  const total = visitGroups.size + entryGroups.size;
  let done = 0;
  let trimmed = 0;
  let removed = 0;
  let skipped = 0;
  const finish = async (
    rows: LinkRow[],
    distances: Map<string, number> | null,
    del: (ids: string[]) => Promise<{ count: number }>
  ) => {
    // Nothing over the cap needs no distances and no search.
    if (linksToTrim(rows, cap).length === 0) return;
    if (distances === null) {
      skipped += 1;
      return;
    }
    const drop = linksToTrim(rows, cap, distances);
    if (drop.length === 0) return;
    trimmed += 1;
    removed += (await del(drop)).count;
  };

  for (const [visitId, rows] of visitGroups) {
    const over = linksToTrim(rows, cap).length > 0;
    await finish(rows, over ? await visitCandidateDistances(userId, visitId) : new Map(), (ids) =>
      prisma.placeVisitPhoto.deleteMany({ where: { id: { in: ids }, provenance: "auto" } })
    );
    onProgress?.(++done, total);
  }
  for (const [holder, rows] of entryGroups) {
    const [kind, id] = holder.split(":") as [EntryKind, string];
    const over = linksToTrim(rows, cap).length > 0;
    await finish(rows, over ? await entryDistances(userId, kind, id, search) : new Map(), (ids) =>
      prisma.entryPhotoLink.deleteMany({
        where: { id: { in: ids }, provenance: "auto", refused: false },
      })
    );
    onProgress?.(++done, total);
  }
  return { trimmed, checked: total, removed, skipped };
}

function fkSelect() {
  return Object.fromEntries(ENTRY_KINDS.map((k) => [ENTRY_FK[k], true])) as {
    [K in (typeof ENTRY_FK)[(typeof ENTRY_KINDS)[number]]]: true;
  };
}
