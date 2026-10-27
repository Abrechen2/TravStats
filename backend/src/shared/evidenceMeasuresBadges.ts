/**
 * Evidence measures — the proof behind every badge that opens its own
 * (forgejo#265, `shared/badgeEvidence.ts`): one measure per rule type, its
 * value the badge's progress, its rows the entries that progress stands on.
 * The country and continent badges read the passport's ground-contact set
 * and list distinct countries or continents (forgejo#299); every other proof
 * is a sum whose rows add up to the progress.
 *
 * MIRRORED at `frontend/src/shared/evidenceMeasuresBadges.ts`.
 */
import type { MeasureSpec } from "./evidenceMeasures";
import { BADGE_PROOF_TYPES, badgeProofKey } from "./badgeEvidence";

/** The proofs that read the passport and list distinct units named like the rule. */
const GEOGRAPHY: ReadonlySet<string> = new Set(["countries", "continents"]);

const CALCULATOR = "services/evidence/badges/badgeEvidence.ts over the badge's own fold";

export const BADGE_MEASURES: Record<string, MeasureSpec> = Object.fromEntries(
  BADGE_PROOF_TYPES.map((type): [string, MeasureSpec] => [
    badgeProofKey(type),
    {
      aggregation: GEOGRAPHY.has(type) ? "distinct" : "sum",
      unit: GEOGRAPHY.has(type) ? type : "progress",
      scopes: ["allTime"],
      surface: "AchievementDetailModal",
      calculator: CALCULATOR,
      servedIn: 1,
    },
  ])
);
