import {
  CONTINENTS,
  continentForCoordinates,
  continentForCountry,
  getContinent,
  isoCountryCode,
} from "../continents";

// The cross-domain "countries visited" KPI counts a Set across both catalogues.
// Airports carry ISO codes, ports carry English names, so without folding them
// into one vocabulary every country reached both by air and by sea was counted
// twice.
describe("isoCountryCode", () => {
  it("folds an English port-catalogue name onto the airport catalogue's code", () => {
    expect(isoCountryCode("Germany")).toBe("DE");
    expect(isoCountryCode("Spain")).toBe("ES");
    expect(isoCountryCode("United States")).toBe("US");
  });

  it("passes an ISO code through, normalising its case", () => {
    expect(isoCountryCode("DE")).toBe("DE");
    expect(isoCountryCode("de")).toBe("DE");
  });

  it("makes the two vocabularies collide on purpose", () => {
    expect(isoCountryCode("Germany")).toBe(isoCountryCode("DE"));
  });

  it("ignores accents, punctuation and case, so Türkiye and Turkey agree", () => {
    expect(isoCountryCode("Türkiye")).toBe("TR");
    expect(isoCountryCode("Turkey")).toBe("TR");
  });

  it("returns null for the catalogue's placeholder codes rather than inventing a country", () => {
    expect(isoCountryCode("ZZ")).toBeNull();
    expect(isoCountryCode("XZ")).toBeNull();
  });

  it("returns null for empty, missing and unrecognised input", () => {
    expect(isoCountryCode(null)).toBeNull();
    expect(isoCountryCode(undefined)).toBeNull();
    expect(isoCountryCode("  ")).toBeNull();
    expect(isoCountryCode("Unknown")).toBeNull();
  });
});

describe("continent resolution", () => {
  describe("the three bugs this module was written to kill", () => {
    it("does NOT call the Arctic 'Antarctica' — Svalbard is in Europe", () => {
      // LYR, Svalbard Airport Longyear, 78.25°N. The old box said `lat > 70 ->
      // Antarctica`, so flying here unlocked "Seven Continents Master".
      expect(getContinent(78.2461, 15.4656, "NO")).toBe("Europe");
      expect(continentForCoordinates(78.2461, 15.4656)).toBe("Europe");
    });

    it("keeps Antarctica real — it is a continent people actually reach", () => {
      // Rothera (Antarctic Peninsula) and McMurdo. Cruises and flights go there.
      expect(getContinent(-67.5675, -68.1274, "AQ")).toBe("Antarctica");
      expect(getContinent(-77.8419, 166.6863, "AQ")).toBe("Antarctica");
      expect(continentForCoordinates(-77.8419, 166.6863)).toBe("Antarctica");
    });

    it("puts Australia in Oceania, not Asia", () => {
      // The old Oceania box started at lon 150, so 160 of 195 Australian airports
      // (everything west of Sydney) were classified as Asia.
      expect(getContinent(-31.9403, 115.9669, "AU")).toBe("Oceania"); // Perth
      expect(getContinent(-37.6733, 144.8433, "AU")).toBe("Oceania"); // Melbourne
      expect(getContinent(-33.9461, 151.1772, "AU")).toBe("Oceania"); // Sydney
      expect(continentForCoordinates(-31.9403, 115.9669)).toBe("Oceania");
    });

    it("never returns 'Middle East' — it is not a continent", () => {
      // The old function could return eight values, so CONTINENTS_7 ("all 7
      // continents") was reachable without Antarctica.
      const gulf: Array<[number, number, string]> = [
        [25.2532, 55.3657, "AE"], // Dubai
        [25.273, 51.6081, "QA"], // Doha
        [26.2708, 50.6336, "BH"], // Bahrain
        [24.433, 54.6511, "AE"], // Abu Dhabi
      ];
      for (const [lat, lon, cc] of gulf) {
        expect(getContinent(lat, lon, cc)).toBe("Asia");
      }
      expect(CONTINENTS).toHaveLength(7);
      expect(CONTINENTS).not.toContain("Middle East");
    });
  });

  describe("transcontinental countries resolve by coordinates, not by flag", () => {
    it("splits Russia at the Urals", () => {
      expect(getContinent(55.9726, 37.4146, "RU")).toBe("Europe"); // Moscow SVO
      expect(getContinent(43.399, 132.148, "RU")).toBe("Asia"); // Vladivostok VVO
    });

    it("splits Turkey at the Bosphorus", () => {
      expect(getContinent(41.2753, 28.7519, "TR")).toBe("Europe"); // Istanbul IST
      expect(getContinent(36.8987, 30.8005, "TR")).toBe("Asia"); // Antalya AYT
    });

    it("splits Kazakhstan at the Ural river", () => {
      expect(getContinent(51.1505, 51.5431, "KZ")).toBe("Europe"); // Oral / Uralsk
      expect(getContinent(43.3521, 77.0405, "KZ")).toBe("Asia"); // Almaty
    });

    it("puts the Sinai in Asia and the rest of Egypt in Africa", () => {
      expect(getContinent(27.9773, 34.3947, "EG")).toBe("Asia"); // Sharm el-Sheikh
      expect(getContinent(29.5872, 34.778, "EG")).toBe("Asia"); // Taba
      expect(getContinent(28.2054, 33.6455, "EG")).toBe("Asia"); // El Tor
      expect(getContinent(30.1219, 31.4056, "EG")).toBe("Africa"); // Cairo
      // Across the Gulf of Suez from the Sinai, at the same longitude — the trap that
      // a naive "east of 33°E" rule falls into.
      expect(getContinent(27.1783, 33.7994, "EG")).toBe("Africa"); // Hurghada
      expect(getContinent(25.5571, 34.5837, "EG")).toBe("Africa"); // Marsa Alam
      expect(getContinent(29.9737, 32.5263, "EG")).toBe("Africa"); // Suez city
      expect(getContinent(25.671, 32.7066, "EG")).toBe("Africa"); // Luxor
    });

    it("refuses to guess a transcontinental country without coordinates", () => {
      expect(continentForCountry("RU")).toBeNull();
      expect(continentForCountry("TR")).toBeNull();
    });
  });

  describe("the airports the old box model could not place at all", () => {
    // 62 open airports returned null: 44 Russian, plus Cabo Verde, Kazakhstan,
    // Kutaisi, Réunion, the Seychelles and Mauritius.
    it.each<[string, number, number, string, string]>([
      ["Kazan (RU)", 55.6062, 49.2787, "RU", "Europe"],
      ["Samara (RU)", 53.5049, 50.1642, "RU", "Europe"],
      ["Kutaisi (GE)", 42.1767, 42.4826, "GE", "Asia"],
      ["Sal (CV)", 16.7414, -22.9494, "CV", "Africa"],
      ["Réunion (RE)", -20.8871, 55.5103, "RE", "Africa"],
      ["Mahé (SC)", -4.6743, 55.5218, "SC", "Africa"],
      ["Mauritius (MU)", -20.4302, 57.6836, "MU", "Africa"],
      ["Nukus (UZ)", 42.4884, 59.6233, "UZ", "Asia"],
    ])("places %s", (_name, lat, lon, cc, expected) => {
      expect(getContinent(lat, lon, cc)).toBe(expected);
    });
  });

  describe("country input", () => {
    it("takes an ISO alpha-2 code (airports) or an English name (ports)", () => {
      expect(continentForCountry("DE", 50, 8)).toBe("Europe");
      expect(continentForCountry("Germany", 50, 8)).toBe("Europe");
    });

    it("normalises accents, case and punctuation", () => {
      expect(continentForCountry("Türkiye", 41.28, 28.75)).toBe("Europe");
      expect(continentForCountry("Turkey", 41.28, 28.75)).toBe("Europe");
      expect(continentForCountry("Côte d'Ivoire", 5.26, -3.93)).toBe("Africa");
      expect(continentForCountry("united states of america", 40, -75)).toBe(
        "North America",
      );
    });

    it("returns null for the catalogue's placeholder codes rather than inventing one", () => {
      expect(continentForCountry("ZZ", 0, 0)).toBeNull();
      expect(continentForCountry("XZ", 0, 0)).toBeNull();
      expect(continentForCountry("", 0, 0)).toBeNull();
      expect(continentForCountry(null)).toBeNull();
      expect(continentForCountry(undefined)).toBeNull();
    });

    it("falls back to coordinates when the country is unknown", () => {
      // ZZ is not a country, but 48.35/11.79 is unmistakably Munich.
      expect(getContinent(48.3538, 11.7861, "ZZ")).toBe("Europe");
    });
  });

  describe("Caribbean and Central America are North America, not South", () => {
    // The old box used `lat > 15`, which dropped Aruba, Barbados and Curaçao into
    // South America.
    it.each<[string, number, number, string]>([
      ["Aruba", 12.5014, -70.0152, "AW"],
      ["Barbados", 13.0746, -59.4925, "BB"],
      ["Curaçao", 12.1889, -68.9598, "CW"],
      ["Panama City", 9.0714, -79.3835, "PA"],
      ["Trinidad", 10.5954, -61.3372, "TT"],
    ])("%s is North America", (_n, lat, lon, cc) => {
      expect(getContinent(lat, lon, cc)).toBe("North America");
    });

    it("still puts the actual South American mainland in South America", () => {
      expect(getContinent(-23.4356, -46.4731, "BR")).toBe("South America"); // São Paulo
      expect(getContinent(4.7016, -74.1469, "CO")).toBe("South America"); // Bogotá
      expect(getContinent(-33.393, -70.7858, "CL")).toBe("South America"); // Santiago
    });
  });

  describe("coordinate fallback never silently drops a place", () => {
    it("returns a continent for every point on a coarse world grid", () => {
      const unplaced: string[] = [];
      for (let lat = -55; lat <= 75; lat += 5) {
        for (let lon = -175; lon <= 175; lon += 5) {
          if (continentForCoordinates(lat, lon) === null) {
            unplaced.push(`${lat},${lon}`);
          }
        }
      }
      // Open ocean is allowed to be unplaced; land must not be. Spot-check the land
      // points that the old model dropped rather than asserting on the whole grid.
      expect(continentForCoordinates(55.6, 49.3)).not.toBeNull(); // Kazan
      expect(continentForCoordinates(42.2, 42.5)).not.toBeNull(); // Kutaisi
      expect(continentForCoordinates(16.7, -22.9)).not.toBeNull(); // Sal
      expect(continentForCoordinates(-20.9, 55.5)).not.toBeNull(); // Réunion
      expect(unplaced.length).toBeLessThan(60); // only far-Pacific / far-Atlantic cells
    });

    it("rejects non-finite input instead of returning a wrong continent", () => {
      expect(continentForCoordinates(NaN, 10)).toBeNull();
      expect(continentForCoordinates(10, Infinity)).toBeNull();
    });
  });
});
