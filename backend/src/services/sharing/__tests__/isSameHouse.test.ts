import { describe, expect, it } from "@jest/globals";

import { isSameHouse, type HouseIdentity } from "../facts";

const house = (over: Partial<HouseIdentity>): HouseIdentity => ({
  name: "Hotel Europa",
  lat: null,
  lon: null,
  city: null,
  country: null,
  isoCountryCode: null,
  ...over,
});

describe("isSameHouse — name AND place", () => {
  it("never merges a same-named house in another city", () => {
    expect(
      isSameHouse(
        house({ city: "Berlin", isoCountryCode: "DE" }),
        house({ city: "Rom", isoCountryCode: "IT" })
      )
    ).toBe(false);
  });

  it("treats a different name as a different house, even at one address", () => {
    expect(
      isSameHouse(
        house({ lat: 52.5, lon: 13.4 }),
        house({ name: "Hotel Asia", lat: 52.5, lon: 13.4 })
      )
    ).toBe(false);
  });

  it("matches within 300 m and not beyond", () => {
    const a = house({ lat: 52.52, lon: 13.405 });
    expect(isSameHouse(a, house({ lat: 52.5215, lon: 13.405 }))).toBe(true); // ~170 m
    expect(isSameHouse(a, house({ lat: 52.525, lon: 13.405 }))).toBe(false); // ~560 m
  });

  it("falls back to city and country when either side has no coordinates", () => {
    const berlin = house({ city: "Berlin", country: "Deutschland" });
    expect(
      isSameHouse(berlin, house({ city: "berlin", country: "deutschland", lat: 1, lon: 1 }))
    ).toBe(true);
    expect(isSameHouse(berlin, house({ city: "Berlin", country: "Germany" }))).toBe(false);
    expect(
      isSameHouse(
        house({ city: "Berlin", isoCountryCode: "DE", country: "Germany" }),
        house({ city: "Berlin", isoCountryCode: "DE", country: "Deutschland" })
      )
    ).toBe(true);
  });

  it("does not match when neither coordinates nor a city are there to compare", () => {
    expect(isSameHouse(house({}), house({}))).toBe(false);
    expect(isSameHouse(house({ country: "DE" }), house({ country: "DE" }))).toBe(false);
  });
});
