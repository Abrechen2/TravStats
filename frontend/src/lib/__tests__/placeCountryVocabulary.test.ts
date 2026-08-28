import { describe, it, expect } from "vitest";
import { placeCountryCode, placeCountryLabel } from "../placeCountry";
import { buildSheets } from "../xlsx/exportAll";
import type { Place } from "../../types/place";

/**
 * Found in the rc.18 UAT, on real data.
 *
 * Reverse geocoding writes a country in ITS OWN language: the same 54 places
 * came back carrying "España", "Lëtzebuerg", "日本", "مصر" and "Egypt". The ISO
 * code was right on every row — but three places in the app read the free-text
 * column instead, and each of them broke differently:
 *
 *   - the summary counted the STRINGS, so 20 countries showed as 23;
 *   - the country filter grouped by ISO but labelled with whichever spelling
 *     sorted first, so a German reader got "مصر" in the dropdown;
 *   - the spreadsheet export printed the raw column, so one sheet held four
 *     spellings for two countries and no filter could group them.
 *
 * The fixture below is exactly that shape: two countries, four spellings.
 */
const t = (key: string): string => key;

function place(over: Partial<Place>): Place {
  return {
    id: "p",
    name: "Ort",
    category: "landmark",
    lat: 0,
    lon: 0,
    address: null,
    city: null,
    country: null,
    isoCountryCode: null,
    externalRef: null,
    curatedItemId: null,
    visited: true,
    notes: null,
    dataSource: null,
    createdAt: "",
    updatedAt: "",
    visits: [],
    visitCount: 0,
    plannedVisitCount: 0,
    lastVisitAt: null,
    ...over,
  } as unknown as Place;
}

const FOUR_SPELLINGS_TWO_COUNTRIES = [
  place({ id: "1", name: "Colosseo", country: "Italia", isoCountryCode: "IT" }),
  place({ id: "2", name: "Pompeji", country: "Italien", isoCountryCode: "IT" }),
  place({ id: "3", name: "Gizeh", country: "مصر", isoCountryCode: "EG" }),
  place({ id: "4", name: "Abu Simbel", country: "Egypt", isoCountryCode: "EG" }),
];

describe("country vocabulary across spellings", () => {
  it("counts two countries, not four", () => {
    const codes = new Set(
      FOUR_SPELLINGS_TWO_COUNTRIES.map((p) => placeCountryCode(p)).filter(Boolean),
    );
    expect(codes.size).toBe(2);
  });

  it("gives every spelling of one country the same label", () => {
    const [it1, it2, eg1, eg2] = FOUR_SPELLINGS_TWO_COUNTRIES;
    expect(placeCountryLabel(it1, "de")).toBe(placeCountryLabel(it2, "de"));
    expect(placeCountryLabel(eg1, "de")).toBe(placeCountryLabel(eg2, "de"));
  });

  it("labels in the reader's language, not the row's", () => {
    const gizeh = FOUR_SPELLINGS_TWO_COUNTRIES[2];
    expect(placeCountryLabel(gizeh, "de")).toBe("Ägypten");
    expect(placeCountryLabel(gizeh, "en")).toBe("Egypt");
  });

  it("exports one spelling per country, so the sheet can be filtered", () => {
    const sheets = buildSheets(t, { places: FOUR_SPELLINGS_TWO_COUNTRIES }, "de");
    const placeSheet = sheets.find((s) => (s.spec as { key: string }).key === "places");
    expect(placeSheet).toBeDefined();

    const spec = placeSheet!.spec as unknown as {
      columns: { key: string; value: (row: unknown) => unknown }[];
    };
    const countryColumn = spec.columns.find((c) => c.key === "country")!;
    const written = new Set(
      FOUR_SPELLINGS_TWO_COUNTRIES.map((p) => String(countryColumn.value(p))),
    );

    expect(written.size).toBe(2);
    expect(written).toContain("Ägypten");
    expect(written).toContain("Italien");
  });

  it("still writes something for a row that has no ISO code at all", () => {
    // The fallback must not turn a known-but-uncoded country into a blank cell.
    const odd = place({ country: "Freistaat Bayern", isoCountryCode: null });
    expect(placeCountryLabel(odd, "de")).toBe("Freistaat Bayern");
  });
});
