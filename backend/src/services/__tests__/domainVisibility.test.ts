import { readFileSync } from "fs";
import path from "path";
import { AVAILABLE_DOMAINS, type DomainKey } from "../../shared/domains";
import { BETA_GATED_DOMAINS, visibleDomainKeys } from "../domainVisibility";

describe("visibleDomainKeys", () => {
  it("hides bus while the instance's beta switch is off, and shows it when on", () => {
    const enabled = ["flight", "bus"];
    expect(visibleDomainKeys(enabled, false)).toEqual(["flight"]);
    expect(visibleDomainKeys(enabled, true)).toEqual(["flight", "bus"]);
  });

  it("keeps an ungated domain visible with the switch off", () => {
    expect(visibleDomainKeys(["flight", "cruise", "bus"], false)).toEqual(["flight", "cruise"]);
  });

  // Rail left beta in 2.7.0-rc.20 (owner, 2026-10-22): like cruises, the
  // user's domain choice alone decides.
  it("shows rail with the beta switch off once the user has it on", () => {
    expect(visibleDomainKeys(["flight", "rail"], false)).toEqual(["flight", "rail"]);
    expect(BETA_GATED_DOMAINS.rail).toBeUndefined();
  });
});

/**
 * The frontend registry is the list of beta gates. A domain whose gate key is
 * missing here would be hidden in the UI yet still folded into the server's
 * figures (trip suggestions, country badges) — the server half of the gate.
 */
describe("BETA_GATED_DOMAINS", () => {
  const registry = readFileSync(
    path.resolve(__dirname, "../../../../frontend/src/config/betaFeatures.ts"),
    "utf8"
  );
  const registryKeys = [...registry.matchAll(/^ {2}([A-Za-z]+): Object\.freeze\(/gm)].map(
    (m) => m[1]
  );
  const domainGateKeys = registryKeys.filter(
    (key) => key.endsWith("Domain") || key === "roadtrips"
  );

  it("finds the domain gates in the registry (the scan itself works)", () => {
    expect(domainGateKeys).toEqual(
      expect.arrayContaining(["rentalDomain", "busDomain", "ferryDomain", "roadtrips"])
    );
  });

  it("has an entry, on a real domain, for every domain gate in the registry", () => {
    const gatedKeys = Object.values(BETA_GATED_DOMAINS);
    for (const key of domainGateKeys) {
      expect(gatedKeys).toContain(key);
    }
    for (const domain of Object.keys(BETA_GATED_DOMAINS) as DomainKey[]) {
      expect(AVAILABLE_DOMAINS).toContain(domain);
    }
  });
});
