import { describe, expect, it } from "vitest";
import { isEntryDomainShown, switchableDomains } from "../../config/domainBetaGates";
import { DOMAIN_KEYS, type DomainKey } from "../../shared/domains";

describe("isEntryDomainShown — the server's upcoming entries under the beta gates", () => {
  // As `useEnabledDomains` answers with every beta switch closed.
  const isEnabled = (key: DomainKey) => ["flight", "lodging"].includes(key);

  it("keeps a roadtrip entry — no beta gate stands in front of it any more", () => {
    expect(isEntryDomainShown("roadtrip", isEnabled)).toBe(true);
    expect(isEntryDomainShown("tour", isEnabled)).toBe(true);
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

  it("offers every domain, roadtrips and tours included, while the beta switches are closed", () => {
    expect(switchableDomains(DOMAIN_KEYS, ["flight"], closed)).toEqual([...DOMAIN_KEYS]);
  });
});
