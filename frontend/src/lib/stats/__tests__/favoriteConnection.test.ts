import { describe, expect, it } from "vitest";

import { favoriteConnection } from "../favoriteConnection";

const leg = (dep: string | null, arr: string | null) => ({
  depIata: dep,
  depIcao: null,
  arrIata: arr,
  arrIcao: null,
});

/**
 * Forgejo #254. The certificate's "most flown route" read the DIRECTED pair, so
 * 4 x HNL->OGG plus 4 x OGG->HNL lost to 5 x FRA->JFK - while the server's top
 * routes, Route Master and Wrapped all say HNL-OGG, eight times.
 */
describe("favoriteConnection", () => {
  it("counts both directions of a pair as one connection", () => {
    const flights = [
      ...Array.from({ length: 4 }, () => leg("HNL", "OGG")),
      ...Array.from({ length: 4 }, () => leg("OGG", "HNL")),
      ...Array.from({ length: 5 }, () => leg("FRA", "JFK")),
    ];
    expect(favoriteConnection(flights)).toBe("HNL ↔ OGG");
  });

  it("shows the pair sorted whichever direction was flown first", () => {
    expect(favoriteConnection([leg("OGG", "HNL")])).toBe("HNL ↔ OGG");
  });

  it("falls back to the ICAO code when there is no IATA code", () => {
    expect(
      favoriteConnection([{ depIata: null, depIcao: "EDDF", arrIata: null, arrIcao: "KJFK" }])
    ).toBe("EDDF ↔ KJFK");
  });

  it("skips a flight with an unknown airport instead of inventing one", () => {
    expect(favoriteConnection([leg(null, "HNL"), leg("FRA", null)])).toBeNull();
    expect(favoriteConnection([leg(null, "HNL"), leg("FRA", "JFK")])).toBe("FRA ↔ JFK");
  });

  it("returns null for no flights", () => {
    expect(favoriteConnection([])).toBeNull();
  });
});
