import { describe, expect, it } from "vitest";
import { isEntryDomainShown, switchableDomains } from "../../config/domainBetaGates";
import { DOMAIN_KEYS, type DomainKey } from "../../shared/domains";

describe("isEntryDomainShown — the server's upcoming entries under the beta gates", () => {
  // As `useEnabledDomains` answers with every beta switch closed.
  const isEnabled = (key: DomainKey) => ["flight", "lodging"].includes(key);

  it("drops a roadtrip entry while its domain is gated out", () => {
    expect(isEntryDomainShown("roadtrip", isEnabled)).toBe(false);
  });

  it("keeps trips and ungated domains — the server already filtered those by the user's choice", () => {
    expect(isEntryDomainShown("trip", isEnabled)).toBe(true);
    expect(isEntryDomainShown("flight", isEnabled)).toBe(true);
    expect(isEntryDomainShown("cruise", isEnabled)).toBe(true);
    // Rail left beta in 2.7.0-rc.20: the server's answer stands, as for cruises.
    expect(isEntryDomainShown("rail", isEnabled)).toBe(true);
    // Rental, bus and ferry left beta on 2026-10-26 (owner): the same.
    for (const domain of ["rental", "bus", "ferry"] as const) {
      expect(isEntryDomainShown(domain, isEnabled)).toBe(true);
    }
  });
});

describe("switchableDomains — the settings and setup switch lists", () => {
  const open = () => true;
  const closed = () => false;

  it("offers every domain while the beta switches are open", () => {
    expect(switchableDomains(DOMAIN_KEYS, [], open)).toEqual([...DOMAIN_KEYS]);
  });

  it("hides a gated domain the user never turned on while its switch is closed", () => {
    const keys = switchableDomains(DOMAIN_KEYS, ["flight"], closed);
    expect(keys).not.toContain("roadtrip");
    expect(keys).toEqual(
      expect.arrayContaining([
        "flight",
        "cruise",
        "lodging",
        "poi",
        "rail",
        "rental",
        "bus",
        "ferry",
      ])
    );
  });

  it("keeps a gated domain the user has on, so it can be switched off — except roadtrips", () => {
    const keys = switchableDomains(
      DOMAIN_KEYS,
      ["rail", "rental", "bus", "ferry", "roadtrip"],
      closed
    );
    expect(keys).toEqual(expect.arrayContaining(["rail", "rental", "bus", "ferry"]));
    expect(keys).not.toContain("roadtrip");
  });
});
