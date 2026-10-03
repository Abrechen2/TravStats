import { describe, it, expect } from "@jest/globals";
import { reminderDomainEnabled } from "../domainEnabled";

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
