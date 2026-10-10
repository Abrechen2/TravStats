import { EVIDENCE_MEASURES } from "../../shared/evidenceMeasures";
import { badgeEvidenceKey } from "../../shared/badgeEvidence";

/**
 * Which achievement rules stand on a statistic the evidence panel can list.
 *
 * #330's public comment promised "for every statistic behind it, the entries
 * that produced the number". The achievement kind itself does not answer yet
 * — `GET /evidence?kind=achievement` is a 501 held for release 2 (owner,
 * 2026-09-18), which the beta audit of 2026-09-19 measured on the live beta.
 * But a great many rules do not need it: "Absolviere 10 Flüge" counts exactly
 * the flights `flightCount` already lists, and that key IS served. This table
 * is the join, so those dialogs can offer the entries today instead of
 * waiting for a kind that answers nothing.
 *
 * The key is the rule's `requirementType` (`backend/src/data/achievementSeeds/*`),
 * not the achievement code — seven codes share `flights_count`, and it is the
 * RULE, not the badge, that names the statistic.
 *
 * Two conditions an entry must meet, both load-bearing:
 *
 * 1. **The measure is really served.** `EvidenceTrigger` says it plainly: a
 *    tile may use it only where a resolver exists, and wiring one on a
 *    registry claim alone "ships a pointer cursor over a 404, which is GitHub
 *    #330 with an extra round trip". `servedIn: 1` and the backend's
 *    `servedMetricKeys()` agree exactly today (78 = 78, held by
 *    `backend/src/services/evidence/__tests__/registryBinding.test.ts`), so
 *    the test below checks this table against `servedIn: 1`.
 * 2. **The numbers are the SAME number, in the same unit.** The rule's
 *    `progress` is passed to the panel as `renderedValue` and compared against
 *    the freshly measured figure, so a near-miss is worse than no entry at
 *    all. That is why `flight_hours` is absent although `flightTimeMinutes`
 *    is served (hours against minutes), and why the boolean rules
 *    (`ocean_crossing`, which is 0 or 1) are absent although the matching
 *    counters are served.
 *
 * Every other rule opens its OWN proof since forgejo#265
 * (`shared/badgeEvidence.ts`): the entries the badge's progress stands on,
 * measured by the badge's own fold. A rule with neither renders an honest
 * sentence in the dialog — and the backend's coverage guard fails for a seed
 * rule that has neither unless it is listed with its reason.
 */
export { BADGE_MEASURE_KEYS as ACHIEVEMENT_EVIDENCE_KEY } from "../../shared/badgeEvidence";

/** The served measure behind this rule, or null when nobody can list it yet. */
export function evidenceKeyForRule(requirementType: string): string | null {
  const key = badgeEvidenceKey(requirementType);
  if (!key) return null;
  // Belt and braces for a measure that is later demoted to release 2: the
  // dialog then falls back to the honest sentence rather than a dead trigger.
  return EVIDENCE_MEASURES[key]?.servedIn === 1 ? key : null;
}
