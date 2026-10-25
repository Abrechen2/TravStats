import { describe, expect, it } from "vitest";
import type { FeatureCollection, Geometry } from "geojson";
import type { TravTrackMonths } from "../../../../lib/api/travtrackMonths";
import { COUNTRY_NUMERIC_TO_ALPHA2 } from "../../../../shared/geo/countryNumeric";
import {
  monthsOfSpan,
  shapeCode,
  visitedCountriesOf,
  visitedShapes,
  yearsOfSpan,
} from "../visitedCountries";

/**
 * The countries layer (plan T5.3): the countries of every UTC month a span
 * touches, from the monthly values; only those shapes are drawn.
 */

const month = (m: string, countries: string[]) => ({
  month: m,
  kmGround: 1,
  countries,
  cities: null,
  daysWithData: 1,
  daysPaused: 0,
});

describe("visitedCountries", () => {
  it("names the months and years a span touches, across a year's end", () => {
    expect(monthsOfSpan("2025-11-20", "2026-01-03")).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(monthsOfSpan("2026-10-25", "2026-10-25")).toEqual(["2026-10"]);
    expect(yearsOfSpan("2024-12-31", "2026-01-01")).toEqual([2024, 2025, 2026]);
  });

  it("unites the touched months' countries and names the pending ones", () => {
    const y2025: TravTrackMonths = {
      months: [month("2025-11", ["DE"]), month("2025-12", ["PT", "es"]), month("2025-10", ["KR"])],
      pending: [],
    };
    const y2026: TravTrackMonths = { months: [month("2026-01", ["DE"])], pending: ["2026-01"] };
    expect(visitedCountriesOf([y2025, y2026], "2025-11-20", "2026-01-03")).toEqual({
      codes: ["DE", "ES", "PT"],
      pending: ["2026-01"],
    });
  });

  it("keys a shape by its numeric code, or by name where the file has none", () => {
    const shape = (id: string | null, name: string) => ({
      type: "Feature" as const,
      id: id ?? undefined,
      properties: { name },
      geometry: { type: "Point" as const, coordinates: [0, 0] },
    });
    expect(shapeCode(shape("276", "Germany"))).toBe("DE");
    expect(shapeCode(shape("840", "United States of America"))).toBe("US");
    expect(shapeCode(shape(null, "N. Cyprus"))).toBe("CY");
    expect(shapeCode(shape(null, "Atlantis"))).toBeNull();
    const world: FeatureCollection<Geometry> = {
      type: "FeatureCollection",
      features: [shape("276", "Germany"), shape("620", "Portugal"), shape("410", "South Korea")],
    };
    expect(visitedShapes(world, ["DE", "PT"]).map((f) => f.id)).toEqual(["276", "620"]);
  });

  it("the table covers every coded shape with a distinct code", () => {
    const codes = Object.values(COUNTRY_NUMERIC_TO_ALPHA2);
    expect(codes.length).toBeGreaterThan(170);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
  });
});
