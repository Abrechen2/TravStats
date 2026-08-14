import { chainFromWebsite, knownChainNames } from "../chainFromWebsite";

describe("chain from a hotel website", () => {
  it("reads the group off the domain where the NAME does not say it", () => {
    // The three real cases this was built for.
    expect(chainFromWebsite("https://www.ihg.com/garner/hotels/de/de/erlangen")).toBe("IHG");
    expect(chainFromWebsite("https://www.hilton.com/en/hotels/hampton-konstanz/")).toBe("Hilton");
    expect(chainFromWebsite("https://all.accor.com/hotel/7146/index.de.shtml")).toBe("Accor");
  });

  it("counts a market sub-domain, because a group runs one per country", () => {
    expect(chainFromWebsite("https://de.hilton.com/berlin")).toBe("Hilton");
    expect(chainFromWebsite("https://www.scandichotels.de/hotel")).toBe("Scandic");
  });

  it("says nothing rather than guessing", () => {
    // An independent house's own site is the NORMAL case, and one of the
    // owner's 279 houses links to a booking vendor. Inventing a chain there
    // would write a wrong row into an instance-wide catalogue.
    expect(chainFromWebsite("https://booking.softtec.software/hotel-gruber")).toBeNull();
    expect(chainFromWebsite("https://hotel-st-martin-marktoberdorf.de")).toBeNull();
    expect(chainFromWebsite("nicht mal eine url")).toBeNull();
    expect(chainFromWebsite(null)).toBeNull();
    expect(chainFromWebsite(undefined)).toBeNull();
  });

  it("never maps a domain that merely CONTAINS a chain domain", () => {
    // `endsWith(".hilton.com")` and not `includes("hilton.com")`: a phishing-
    // shaped host like `hilton.com.example.net` is not Hilton.
    expect(chainFromWebsite("https://hilton.com.beispiel.net/hotel")).toBeNull();
  });

  it("only ever produces names the seeded catalogue actually has", () => {
    // The connect-by-name in the backfill throws if a name does not exist, so
    // this list and the chain seed must stay in step.
    expect(knownChainNames()).toEqual(
      ["Accor", "Best Western", "Hilton", "IHG", "Marriott", "Meliá", "NH Hotels", "Radisson", "Scandic", "Wyndham"],
    );
  });
});
