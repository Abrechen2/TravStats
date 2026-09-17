import { proposeLodgingMatch, type StoredLodging } from "../proposeMatch";

/**
 * forgejo#118. The case that earns this module is the one measured on the beta
 * on 2026-09-10: a real hotel invoice photographed by the Companion, OCR
 * confidence 67, read as
 *
 *   name    "DORMERO Hotel Zürich Airport"
 *   address "Schalfhauserstrasse 101, 8152"   (Schaffhauserstrasse)
 *   city    "Oplikon"                          (Opfikon)
 *
 * The client demanded name AND city to match exactly, so one letter in the
 * city made it a different house. It was created twice.
 */

const house = (
  over: Partial<StoredLodging> & Pick<StoredLodging, "id" | "name">
): StoredLodging => ({
  address: null,
  city: null,
  country: null,
  lat: null,
  lon: null,
  stayCount: 0,
  ...over,
});

// DORMERO Zürich Airport, as stored.
const DORMERO = house({
  id: "dormero",
  name: "DORMERO Hotel Zürich Airport",
  address: "Schaffhauserstrasse 101",
  city: "Opfikon",
  country: "Schweiz",
  lat: 47.4302,
  lon: 8.5709,
  stayCount: 3,
});

describe("proposeLodgingMatch", () => {
  it("recognises the house through a misread city, once the address is geocoded", () => {
    // The geocoder put the misread address within the building's footprint.
    const result = proposeLodgingMatch([DORMERO], {
      name: "DORMERO Hotel Zürich Airport",
      address: "Schalfhauserstrasse 101, 8152",
      city: "Oplikon",
      lat: 47.4303,
      lon: 8.571,
    });

    expect(result.action).toBe("merge");
    expect(result.reason).toBe("coordinates");
    expect(result.match?.id).toBe("dormero");
    expect(result.match?.distanceMetres).toBeLessThanOrEqual(75);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("still answers from the name when nothing could be geocoded", () => {
    const result = proposeLodgingMatch([DORMERO], {
      name: "DORMERO Hotel Zürich Airport",
      city: "Opfikon",
    });

    expect(result.action).toBe("merge");
    expect(result.reason).toBe("name");
    expect(result.match?.distanceMetres).toBeNull();
  });

  it("refuses the same name in a different town", () => {
    const result = proposeLodgingMatch(
      [house({ id: "rose-bern", name: "Hotel Rose", city: "Bern" })],
      {
        name: "Hotel Rose",
        city: "Basel",
      }
    );

    expect(result.action).toBe("create");
    expect(result.match).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("does not read a missing city as a different city", () => {
    // A saved-places export carries no city. Reading that as "not Opfikon"
    // is what turns an absent field into a refusal to match.
    const result = proposeLodgingMatch(
      [house({ id: "x", name: "Emirates Palace Mandarin Oriental" })],
      {
        name: "Emirates Palace",
      }
    );

    expect(result.action).toBe("merge");
    expect(result.reason).toBe("name");
  });

  it("keeps two houses apart when they are a block away and share no name", () => {
    const result = proposeLodgingMatch([DORMERO], {
      name: "Radisson Blu",
      city: "Opfikon",
      lat: 47.44,
      lon: 8.59,
    });

    expect(result.action).toBe("create");
  });

  it("says what completing the stored row would add", () => {
    const sparse = house({
      id: "sparse",
      name: "DORMERO Hotel Zürich Airport",
      city: "Opfikon",
      lat: 47.4302,
      lon: 8.5709,
      stayCount: 1,
    });

    const result = proposeLodgingMatch([sparse], {
      name: "DORMERO Hotel Zürich Airport",
      address: "Schaffhauserstrasse 101",
      city: "Opfikon",
      country: "Schweiz",
      lat: 47.4302,
      lon: 8.5709,
    });

    expect(result.match?.fillsFields).toEqual(expect.arrayContaining(["address", "country"]));
    expect(result.match?.fillsFields).not.toContain("city");
    expect(result.match?.fillsFields).not.toContain("coordinates");
    expect(result.match?.stayCount).toBe(1);
  });

  it("prefers the nearer of two pinned houses", () => {
    const far = house({ id: "far", name: "Hotel A", lat: 47.4302, lon: 8.5731 });
    const near = house({ id: "near", name: "Hotel B", lat: 47.4302, lon: 8.5709 });

    const result = proposeLodgingMatch([far, near], {
      name: "Something else entirely",
      lat: 47.4302,
      lon: 8.5709,
    });

    expect(result.match?.id).toBe("near");
  });

  it("answers create for an empty library", () => {
    expect(proposeLodgingMatch([], { name: "Anything" }).action).toBe("create");
  });
});
