import { describe, it, expect } from "vitest";
import { buildRulesEmbed, buildWelcomeEmbed, RULES_MARKER } from "../src/content.js";

describe("content", () => {
  it("rules embed carries the idempotency marker in the footer", () => {
    const data = buildRulesEmbed().toJSON();
    expect(data.footer?.text).toContain(RULES_MARKER);
  });

  it("rules embed lists all seven rules and the escalation line", () => {
    const text = JSON.stringify(buildRulesEmbed().toJSON());
    for (const n of ["1.", "2.", "3.", "4.", "5.", "6.", "7."]) {
      expect(text).toContain(n);
    }
    expect(text).toContain("Warnung");
    expect(text).toContain("Ban");
  });

  it("rules embed mentions the airplane beta reaction in DE and EN", () => {
    const text = JSON.stringify(buildRulesEmbed().toJSON());
    expect(text).toContain("✈️");
    expect(text.toLowerCase()).toContain("beta");
  });

  it("rules embed includes an English mirror", () => {
    const text = JSON.stringify(buildRulesEmbed().toJSON());
    expect(text).toContain("Be respectful");
    expect(text).toContain("Sei respektvoll");
  });

  it("welcome embed names TravStats and links docs", () => {
    const text = JSON.stringify(buildWelcomeEmbed().toJSON());
    expect(text).toContain("TravStats");
    expect(text).toContain("travstats.de/docs");
  });
});
