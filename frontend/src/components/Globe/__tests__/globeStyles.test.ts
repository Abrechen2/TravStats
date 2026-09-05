import { describe, it, expect } from "vitest";
import { STYLE_OPTIONS } from "../globeStyles";
import { FLAT_BASEMAPS } from "../../map/basemapStyles";

describe("globeStyles", () => {
  it("offers the same six basemap ids as the flat map, so a stored styleId survives the 2D <-> 3D switch", () => {
    expect(STYLE_OPTIONS.map((s) => s.id)).toEqual(FLAT_BASEMAPS.map((b) => b.id));
  });

  it("pairs every style with a complete sky config", () => {
    for (const option of STYLE_OPTIONS) {
      expect(option.sky["sky-color"]).toMatch(/^#[0-9a-f]{6}$/);
      expect(option.sky["horizon-color"]).toMatch(/^#[0-9a-f]{6}$/);
      expect(option.sky["fog-color"]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("builds the raster styles (satellite, osm) as full specifications with glyphs", () => {
    for (const id of ["satellite", "osm"] as const) {
      const option = STYLE_OPTIONS.find((s) => s.id === id);
      expect(option).toBeDefined();
      expect(typeof option?.url).toBe("object");
      if (typeof option?.url === "object") {
        expect(option.url.version).toBe(8);
        expect(option.url.glyphs).toContain("{fontstack}");
      }
    }
  });
});
