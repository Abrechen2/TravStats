import { achievements } from "../../../../data/achievements";
import {
  BADGE_MEASURE_KEYS,
  BADGE_PROOF_TYPES,
  BADGE_WITHOUT_EVIDENCE,
  badgeEvidenceKey,
  badgeProofKey,
} from "../../../../shared/badgeEvidence";
import { servedMetricKeys } from "../../metricEvidence";
import { CORE_REQUIREMENT_TYPES } from "../badgeFamiliesCore";
import { DOMAIN_REQUIREMENT_TYPES } from "../badgeFamiliesDomains";

/**
 * forgejo#265 — "Auszeichnungen nennen Bedingung, Fortschritt und Belege".
 * Every rule type in the seeds opens a list of entries, or is listed in
 * `BADGE_WITHOUT_EVIDENCE` with the reason it cannot. A new badge rule fails
 * here until it is given one of the three answers.
 */
const seedTypes = [...new Set(achievements.map((a) => a.requirementType))].sort();

describe("every badge rule names its evidence", () => {
  it("finds the seeds — otherwise the guard passes on nothing", () => {
    expect(seedTypes.length).toBeGreaterThan(150);
  });

  it("gives every seed rule exactly one answer", () => {
    const answers = (type: string) =>
      [
        type in BADGE_MEASURE_KEYS,
        BADGE_PROOF_TYPES.includes(type),
        type in BADGE_WITHOUT_EVIDENCE,
      ].filter(Boolean).length;
    expect(seedTypes.filter((type) => answers(type) !== 1)).toEqual([]);
  });

  it("names a reason for every rule without evidence", () => {
    expect(
      Object.entries(BADGE_WITHOUT_EVIDENCE).filter(([, why]) => why.trim().length < 20)
    ).toEqual([]);
  });

  it("serves every key a badge opens", () => {
    const served = new Set(servedMetricKeys());
    expect(
      seedTypes
        .map((type) => [type, badgeEvidenceKey(type)] as const)
        .filter(([, key]) => key !== null && !served.has(key))
    ).toEqual([]);
  });

  it("measures every proof in a family of the badge's own fold", () => {
    const answered = new Set([...CORE_REQUIREMENT_TYPES, ...DOMAIN_REQUIREMENT_TYPES, "countries"]);
    expect(
      BADGE_PROOF_TYPES.filter(
        (type) => !answered.has(type) && !type.startsWith("curated_list_ticked:")
      )
    ).toEqual([]);
  });

  it("keeps one key per rule", () => {
    const keys = BADGE_PROOF_TYPES.map(badgeProofKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(badgeProofKey("curated_list_ticked:world-heritage")).toBe(
      "badgeCuratedListTickedWorldHeritage"
    );
  });
});
