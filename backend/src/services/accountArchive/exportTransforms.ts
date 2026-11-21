import { publicEvidence } from "../dawarich/stays/publicStay";
import { normalizeItems, projectFor, sameServerAccount } from "../packing/items";

/**
 * Column values the archive writes differently from how they are stored, for the
 * same reasons the JSON export does (`services/export/allDataExport.ts`): a stay's
 * evidence without the server-keyed point digests, a trip's packing list without
 * what co-planners keep for themselves, and a plan's read-only legacy packing copy.
 */
type Row = Record<string, unknown>;

const TRANSFORMS: Readonly<Record<string, (row: Row, userId: string) => Row>> = {
  dawarich_stays: (row) => ({ ...row, evidence: publicEvidence(row.evidence) }),
  trip_packing_lists: (row, userId) => ({
    ...row,
    items: projectFor(normalizeItems(row.items), {
      principal: sameServerAccount(userId),
      isTripOwner: true,
    }),
  }),
  travel_plans: (row) => {
    const state = row.state;
    if (!state || typeof state !== "object" || Array.isArray(state) || !("packing" in state)) {
      return row;
    }
    const { packing: _legacy, ...rest } = state as Row;
    return { ...row, state: rest };
  },
};

export function transformForExport(
  table: string,
  row: Row,
  userId: string,
  strip: readonly string[]
): Row {
  const stripped = strip.length
    ? { ...row, ...Object.fromEntries(strip.filter((c) => c in row).map((c) => [c, null])) }
    : row;
  const transform = TRANSFORMS[table];
  return transform ? transform(stripped, userId) : stripped;
}
