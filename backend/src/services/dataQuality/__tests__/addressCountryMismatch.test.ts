/**
 * The check that found the live case: a house whose geocoder and whose address
 * name two different countries.
 *
 * Every case here is written from the design's own table (§3.5), and the last
 * three pin the SILENCE — a check that fires on an ordinary address would put
 * noise in an inbox, and an inbox with noise in it is one nobody reads.
 */
import { describe, it, expect } from "@jest/globals";

import {
  addressCountryTail,
  findAddressCountryMismatches,
  type AddressBearingRecord,
} from "../checks/addressCountryMismatch";

const lodging = (over: Partial<AddressBearingRecord> = {}): AddressBearingRecord => ({
  entityType: "lodging",
  id: "l1",
  address: null,
  country: null,
  isoCountryCode: null,
  ...over,
});

describe("addressCountryTail", () => {
  it("reads the last comma-separated component", () => {
    expect(addressCountryTail("Grajska cesta 2, 8222 Otočec, Slovenia")).toBe("Slovenia");
  });

  it("refuses a single-component address", () => {
    // "Chad Street" must not read as Chad.
    expect(addressCountryTail("Chad Street 14")).toBeNull();
  });

  it("refuses a two-letter tail", () => {
    // In an address tail this is a state abbreviation far more often than a
    // country code, and `resolveCountryCode` would take it as the code.
    expect(addressCountryTail("100 Main St, Sacramento, CA")).toBeNull();
  });
});

describe("findAddressCountryMismatches", () => {
  it("flags the Hotel Sport case: place ID says Bucharest, address says Slovenia", () => {
    const findings = findAddressCountryMismatches([
      lodging({
        id: "hotel-sport",
        address: "Grajska cesta 2, 8222 Otočec, Slovenia",
        country: "Romania",
        isoCountryCode: "RO",
      }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      entityType: "lodging",
      entityId: "hotel-sport",
      kind: "address_country_mismatch",
    });
    // BOTH values travel, and neither is marked correct — a geocoder does not
    // get a veto over the user's own data.
    expect(findings[0].details).toMatchObject({
      claimedCountryCode: "RO",
      claimedCountryText: "Romania",
      addressCountryCode: "SI",
      addressCountryText: "Slovenia",
    });
  });

  it("reads the address country in whatever language it was written in", () => {
    const findings = findAddressCountryMismatches([
      lodging({ address: "Hauptstraße 1, Wien, Österreich", isoCountryCode: "DE" }),
    ]);

    expect(findings.map((f) => f.details)).toMatchObject([{ addressCountryCode: "AT" }]);
  });

  it("falls back to the free-text country where no code was derived", () => {
    const findings = findAddressCountryMismatches([
      lodging({ address: "Via Roma 1, Milano, Italia", country: "Deutschland" }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].details).toMatchObject({
      claimedCountryCode: "DE",
      addressCountryCode: "IT",
    });
  });

  it("stays silent when the two agree", () => {
    expect(
      findAddressCountryMismatches([
        lodging({ address: "Strada Lipscani 1, București, Romania", isoCountryCode: "RO" }),
      ])
    ).toEqual([]);
  });

  it("stays silent when the address names no country", () => {
    // Abstention is a result. An address that ends in a town is a gap, not a
    // contradiction, and this check has nothing to say about it.
    expect(
      findAddressCountryMismatches([
        lodging({ address: "Grajska cesta 2, 8222 Otočec", isoCountryCode: "RO" }),
      ])
    ).toEqual([]);
  });

  it("stays silent when the record claims no country", () => {
    expect(
      findAddressCountryMismatches([lodging({ address: "Via Roma 1, Milano, Italia" })])
    ).toEqual([]);
  });

  it("checks places on the same rule as lodgings", () => {
    const findings = findAddressCountryMismatches([
      lodging({
        entityType: "place",
        id: "p1",
        address: "1 Rue X, Paris, France",
        isoCountryCode: "ES",
      }),
    ]);

    expect(findings).toMatchObject([{ entityType: "place", entityId: "p1" }]);
  });
});
