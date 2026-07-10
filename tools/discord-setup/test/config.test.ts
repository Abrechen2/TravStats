import { describe, it, expect } from "vitest";
import { CATEGORIES, ROLES, BETA_REACTION } from "../src/config.js";

describe("config", () => {
  it("defines all seven categories in order", () => {
    expect(CATEGORIES.map((c) => c.name)).toEqual([
      "INFO", "COMMUNITY", "SUPPORT", "DEV", "BETA", "STAFF", "VOICE",
    ]);
  });

  it("applies the two Sublarr renames", () => {
    const allChannels = CATEGORIES.flatMap((c) => c.channels.map((ch) => ch.name));
    expect(allChannels).toContain("import-help");
    expect(allChannels).toContain("mobile-app");
    expect(allChannels).not.toContain("providers");
    expect(allChannels).not.toContain("plugin-dev");
  });

  it("marks bug-report and feature-request as forum channels", () => {
    const forums = CATEGORIES
      .flatMap((c) => c.channels)
      .filter((ch) => ch.kind === "forum")
      .map((ch) => ch.name);
    expect(forums).toEqual(["bug-report", "feature-request"]);
  });

  it("restricts BETA and STAFF categories", () => {
    expect(CATEGORIES.find((c) => c.name === "BETA")?.visibility).toBe("beta");
    expect(CATEGORIES.find((c) => c.name === "STAFF")?.visibility).toBe("staff");
  });

  it("has unique channel names across the whole server", () => {
    const names = CATEGORIES.flatMap((c) => c.channels.map((ch) => ch.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it("defines three roles with the brand colors", () => {
    expect(ROLES.map((r) => [r.name, r.color])).toEqual([
      ["Maintainer", "#f0a947"],
      ["Moderator", "#4aa6b0"],
      ["Beta-Tester", "#7bc47f"],
    ]);
  });

  it("uses the airplane beta reaction", () => {
    expect(BETA_REACTION).toBe("✈️");
  });
});
