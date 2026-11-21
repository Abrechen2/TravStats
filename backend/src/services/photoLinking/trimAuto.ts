import { prisma } from "../../db";
import { photoCapFor } from "./cap";
import { ENTRY_FK, ENTRY_KINDS } from "./entryKinds";
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
 * Stored links carry no distance, so the ranking here has the time spread and
 * the near-duplicate rule only; every stored link passed the radius check when
 * it was linked. Idempotent: a second run finds nothing over the cap.
 */

export interface TrimResult {
  /** Visits and entries that held links over their cap. */
  trimmed: number;
  /** Visits and entries looked at. */
  checked: number;
  removed: number;
}

interface LinkRow {
  id: string;
  key: string;
  at: number;
  provenance: string;
}

/** The auto links to delete for one holder: all but the spread picks of what room is left. */
export function linksToTrim(rows: readonly LinkRow[], cap: number): string[] {
  const manual = rows.filter((r) => r.provenance !== "auto").length;
  const room = Math.max(0, cap - manual);
  const auto = rows.filter((r) => r.provenance === "auto");
  if (auto.length <= room) return [];
  // An undated link has no place on the time axis; it is the first to go.
  const dated: SpreadItem[] = auto
    .filter((r) => Number.isFinite(r.at))
    .map((r) => ({ key: r.id, at: r.at, distanceKm: null }));
  const keep = new Set(pickSpread(dated, room).map((i) => i.key));
  return auto.filter((r) => !keep.has(r.id)).map((r) => r.id);
}

function group(rows: { holder: string; row: LinkRow }[]): Map<string, LinkRow[]> {
  const out = new Map<string, LinkRow[]>();
  for (const { holder, row } of rows) out.set(holder, [...(out.get(holder) ?? []), row]);
  return out;
}

export async function trimAutoLinks(
  userId: string,
  onProgress?: (done: number, total: number) => void
): Promise<TrimResult> {
  const cap = await photoCapFor(userId);
  const [visitRows, entryRows] = await Promise.all([
    prisma.placeVisitPhoto.findMany({
      where: { immichAssetId: { not: null }, visit: { userId } },
      select: { id: true, placeVisitId: true, takenAt: true, provenance: true },
    }),
    prisma.entryPhotoLink.findMany({
      where: { userId, refused: false },
      select: { id: true, provenance: true, takenAt: true, ...fkSelect() },
    }),
  ]);
  const visitGroups = group(
    visitRows.map((r) => ({
      holder: `visit:${r.placeVisitId}`,
      row: {
        id: r.id,
        key: r.id,
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
            key: r.id,
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
  for (const [groups, remove] of [
    [
      visitGroups,
      (ids: string[]) =>
        prisma.placeVisitPhoto.deleteMany({ where: { id: { in: ids }, provenance: "auto" } }),
    ],
    [
      entryGroups,
      (ids: string[]) =>
        prisma.entryPhotoLink.deleteMany({
          where: { id: { in: ids }, provenance: "auto", refused: false },
        }),
    ],
  ] as const) {
    for (const rows of groups.values()) {
      const drop = linksToTrim(rows, cap);
      if (drop.length > 0) {
        const { count } = await remove(drop);
        trimmed += 1;
        removed += count;
      }
      onProgress?.(++done, total);
    }
  }
  return { trimmed, checked: total, removed };
}

function fkSelect() {
  return Object.fromEntries(ENTRY_KINDS.map((k) => [ENTRY_FK[k], true])) as {
    [K in (typeof ENTRY_FK)[(typeof ENTRY_KINDS)[number]]]: true;
  };
}
