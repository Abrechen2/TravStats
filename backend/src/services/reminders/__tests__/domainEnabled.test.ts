import { describe, it, expect } from "@jest/globals";
import { reminderDomainEnabled, reminderDomainVisible } from "../domainEnabled";

describe("reminderDomainEnabled", () => {
  it("is true only for a domain the user has switched on", () => {
    const settings = { enabledDomains: ["flight", "rail"] };
    expect(reminderDomainEnabled(settings, "flight")).toBe(true);
    expect(reminderDomainEnabled(settings, "rail")).toBe(true);
    expect(reminderDomainEnabled(settings, "cruise")).toBe(false);
    expect(reminderDomainEnabled(settings, "lodging")).toBe(false);
  });

  it("reads an account without a settings row as the schema default: flights only", () => {
    expect(reminderDomainEnabled(null, "flight")).toBe(true);
    expect(reminderDomainEnabled(undefined, "flight")).toBe(true);
    expect(reminderDomainEnabled(null, "cruise")).toBe(false);
  });

  it("takes an empty list at its word", () => {
    expect(reminderDomainEnabled({ enabledDomains: [] }, "flight")).toBe(false);
  });
});

describe("reminderDomainVisible", () => {
  const settings = { enabledDomains: ["flight", "rail", "ferry", "bus"] };

  it("holds a beta-gated domain back while the instance's beta switch is off", () => {
    expect(reminderDomainVisible(settings, "ferry", false)).toBe(false);
    expect(reminderDomainVisible(settings, "bus", false)).toBe(false);
    expect(reminderDomainVisible(settings, "ferry", true)).toBe(true);
    expect(reminderDomainVisible(settings, "bus", true)).toBe(true);
  });

  it("leaves an ungated domain to the user's own switch", () => {
    expect(reminderDomainVisible(settings, "rail", false)).toBe(true);
    expect(reminderDomainVisible(settings, "cruise", true)).toBe(false);
  });

  it("never sends for a domain the user switched off, whatever the instance shows", () => {
    expect(reminderDomainVisible({ enabledDomains: ["flight"] }, "bus", true)).toBe(false);
  });
});
