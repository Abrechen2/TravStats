import { prisma } from "../../db";
import type {
  PlaceDedupeHint,
  PlaceImportAction,
  PlaceImportCandidate,
  PlaceImportFlag,
  PlaceImportPreviewRow,
  PlaceImportSummary,
} from "../../schemas/placeImport";

/**
 * What an import WOULD do, before it does any of it — POI Phase D §5.
 *
 * The preview exists so the user decides, not the parser. Three verdicts, and
 * the middle one is the reason this is a preview at all:
 *
 * - `skip` — already here. Matched on `externalRef`, which is what makes
 *   re-importing the same file a no-op rather than a pile of duplicates.
 * - `needs_input` — a good row with no position. NOT a failure and NOT dropped:
 *   a Google Takeout row carries a name, a note and no coordinates at all, and
 *   the person importing it knows where the place is even when the geocoder
 *   does not. It is offered back to them.
 * - `create` — nothing in the way.
 */

/** Two places within this distance, with the same name, are probably one place. */
const NEARBY_KM = 0.2;

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

const normalize = (name: string): string => name.trim().toLowerCase();

/** A date the user typed, or nothing. Never a guess — see `malformed_date`. */
function readVisitedAt(raw: string | null | undefined): { ok: boolean; empty: boolean } {
  if (raw === null || raw === undefined || raw.trim() === "") return { ok: true, empty: true };
  const parsed = new Date(raw);
  return { ok: !Number.isNaN(parsed.getTime()), empty: false };
}

export interface PlaceImportPreview {
  rows: PlaceImportPreviewRow[];
  summary: PlaceImportSummary;
}

export async function previewPlaceImport(
  userId: string,
  candidates: readonly PlaceImportCandidate[]
): Promise<PlaceImportPreview> {
  // Scoped to this user, always: the whole point of a dedupe index is undone if
  // it can see someone else's rows.
  const existing = await prisma.place.findMany({
    where: { userId },
    select: { id: true, name: true, lat: true, lon: true, externalRef: true },
  });

  const byRef = new Map<string, string>();
  for (const p of existing) {
    if (p.externalRef) byRef.set(p.externalRef, p.id);
  }

  const rows: PlaceImportPreviewRow[] = candidates.map((c) => {
    const flags: PlaceImportFlag[] = [];
    let dedupeHint: PlaceDedupeHint = "none";
    let matchedPlaceId: string | null = null;
    let action: PlaceImportAction = "create";

    const hasPosition =
      typeof c.lat === "number" &&
      typeof c.lon === "number" &&
      Number.isFinite(c.lat) &&
      Number.isFinite(c.lon);

    if (!c.name.trim()) flags.push("missing_name");

    const visited = readVisitedAt(c.visitedAt);
    // A date that cannot be read is flagged and dropped, never guessed. The row
    // still imports: losing a visit date costs a field, inventing one puts the
    // user somewhere they were not.
    if (!visited.ok) flags.push("malformed_date");

    if (c.externalRef && byRef.has(c.externalRef)) {
      dedupeHint = "place_exact_ref";
      matchedPlaceId = byRef.get(c.externalRef) ?? null;
      action = "skip";
    } else if (hasPosition) {
      // Same name, same spot, no shared identity — the likeliest cause is the
      // user adding it by hand before ever importing. Offered as a decision
      // rather than skipped, because only they can say whether it is the same
      // place; the ref-based skip above is the one that is certain.
      const near = existing.find(
        (p) =>
          normalize(p.name) === normalize(c.name) &&
          haversineKm(p.lat, p.lon, c.lat as number, c.lon as number) <= NEARBY_KM
      );
      if (near) {
        dedupeHint = "place_nearby";
        matchedPlaceId = near.id;
        action = "needs_input";
      }
    }

    if (!hasPosition) {
      flags.push("missing_coordinates");
      // Deliberately after the dedupe check: a row already here is `skip` even
      // without coordinates, because there is nothing to ask about.
      if (action !== "skip") action = "needs_input";
    }

    return { ...c, flags, dedupeHint, matchedPlaceId, action };
  });

  return {
    rows,
    summary: {
      newRows: rows.filter((r) => r.action === "create").length,
      alreadyPresent: rows.filter((r) => r.action === "skip").length,
      needsInput: rows.filter((r) => r.action === "needs_input").length,
    },
  };
}
