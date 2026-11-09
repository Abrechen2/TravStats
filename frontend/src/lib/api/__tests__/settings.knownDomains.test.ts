import { describe, it, expect, vi, beforeEach } from "vitest";
import { settingsApi } from "../settings";
import { api } from "../client";
import { DOMAIN_KEYS } from "../../../shared/domains";

vi.mock("../client", () => ({
  api: { get: vi.fn(), put: vi.fn() },
  API_URL: "http://localhost",
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.put).mockResolvedValue({ data: {} });
});

/**
 * tours-own-domain T1: the server keeps `tour` as stored when a write does not
 * name the key in `knownDomains`. The web knows every key, so it says so —
 * otherwise it could never switch tours off.
 */
describe("settingsApi.update — knownDomains", () => {
  it("sends the domain keys this build knows with every enabledDomains write", async () => {
    await settingsApi.update({ enabledDomains: ["flight"] });
    expect(api.put).toHaveBeenCalledWith("/settings", {
      enabledDomains: ["flight"],
      knownDomains: [...DOMAIN_KEYS],
    });
    expect(DOMAIN_KEYS).toContain("tour");
  });

  it("leaves a write that does not touch the domains alone", async () => {
    await settingsApi.update({ baseCurrency: "EUR" });
    expect(api.put).toHaveBeenCalledWith("/settings", { baseCurrency: "EUR" });
  });
});
