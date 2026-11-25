import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { LEADERBOARD_METRICS } from "../../../shared/comparisonMetrics";
import { countingRuleOf, RULE_HOME } from "../countingRules";

describe("Wie gezählt? counting rules", () => {
  it.each(LEADERBOARD_METRICS.map((m) => m.key))("%s names a counting rule", (key) => {
    expect(countingRuleOf(key)).not.toBeNull();
  });
  it("every rule's home is a real shared module", () => {
    for (const home of Object.values(RULE_HOME))
      expect(fs.existsSync(path.join(__dirname, "../../../../../backend/src", home))).toBe(true);
  });
});
