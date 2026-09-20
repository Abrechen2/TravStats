import { describe, it, expect } from "vitest";
import { PathLayer } from "@deck.gl/layers";
import { EarthOcclusionExtension } from "../Globe/EarthOcclusionExtension";
import { occludeExtraLayers } from "../Globe/occludeExtraLayers";

/**
 * A caller's own layers — the dashboard's tour paths, the Reise view's trip —
 * were appended to the globe's layer list raw. The globe's own layers all
 * carry `EarthOcclusionExtension`, which discards fragments past the horizon;
 * the caller's did not, so a tour on the far side of the earth drew straight
 * THROUGH it.
 *
 * The extension hooks `DECKGL_FILTER_GL_POSITION` / `DECKGL_FILTER_COLOR`,
 * which every core layer supports, and its own doc names PathLayer,
 * ColumnLayer and IconLayer — so it is applied to whatever the caller passed
 * rather than to a list of blessed types.
 */
describe("occludeExtraLayers", () => {
  const ext = new EarthOcclusionExtension();
  const props = { earthOcclusionEnabled: true, earthOcclusionFadeBand: 0.04 };

  it("gives a caller's layer the occlusion extension and its uniforms", () => {
    const out = occludeExtraLayers([new PathLayer({ id: "tour", data: [] })], ext, props);
    expect(out).toHaveLength(1);
    expect(out[0].props.extensions).toContain(ext);
    expect(out[0].props).toMatchObject(props);
    // The layer is still the caller's — same id, so deck.gl diffs it as one.
    expect(out[0].id).toBe("tour");
  });

  it("keeps an extension the caller already applied", () => {
    const other = new EarthOcclusionExtension();
    const out = occludeExtraLayers(
      [new PathLayer({ id: "tour", data: [], extensions: [other] })],
      ext,
      props
    );
    expect(out[0].props.extensions).toEqual([other, ext]);
  });

  it("adds nothing twice when the caller already occludes", () => {
    const out = occludeExtraLayers(
      [new PathLayer({ id: "tour", data: [], extensions: [ext] })],
      ext,
      props
    );
    expect(out[0].props.extensions).toEqual([ext]);
  });

  it("returns the same array when there is nothing to do", () => {
    const empty: never[] = [];
    expect(occludeExtraLayers(empty, ext, props)).toBe(empty);
  });
});
