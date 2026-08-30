import { describe, it, expect } from "vitest";
import type { PathLayerProps } from "@deck.gl/layers";
import { buildTourDeckLayers, TOUR_PATH_GLOBE_ALTITUDE_M } from "../tourMapOverlay";
import type { TourPathDatum } from "../../../layers/tourPathsLayer";

// deck.gl's `Layer` base class types `.props` generically
// (`StatefulComponentProps<Required<LayerProps>>`), so reading a
// layer-specific accessor like `getPath` back off a constructed instance
// needs the concrete `PathLayerProps` shape -- this is a test-only read of
// the same props object the constructor was called with, not something
// deck.gl exposes narrowly by design.
function pathAccessor(props: unknown): (d: TourPathDatum) => unknown {
  return (props as PathLayerProps<TourPathDatum>).getPath as (d: TourPathDatum) => unknown;
}

/**
 * Fix round 2 (2026-08-30, browser verification): `/dashboard/tour?mode=
 * routes` drew the tour line correctly; `/dashboard/tour?mode=globe` drew
 * NOTHING under a legend that still claimed five modes were present.
 *
 * Root cause, found in `Globe/buildGlobeLayers.ts`'s own doc comment for
 * `CRUISE_PATH_ALTITUDE_M` (a previously-diagnosed instance of the exact
 * same defect): a 2-D `[lng, lat]` path with no altitude component renders
 * at exactly altitude 0 under MapLibre's globe projection, which shares
 * depth-buffer values with the sphere mesh itself -- every fragment loses
 * the depth test and nothing reaches the screen. Cruise paths already
 * lift 5 km off the surface for this reason; the tour path layer never
 * did, because it had only ever been fed into the flat map before fix
 * round 1 wired `extraLayers` into GlobeView.
 *
 * This test cannot prove pixels appear on a real globe -- that needs an
 * actual WebGL context, which jsdom does not provide, and no test in this
 * suite (before or after this fix) exercises deck.gl's GPU pipeline. What
 * IS provable without WebGL, and is exactly the mechanism that broke, is
 * the DATA `buildTourDeckLayers` hands to the `PathLayer`'s `getPath`
 * accessor: whether it carries a non-zero altitude. A deck.gl `Layer`
 * instance exposes its constructor props (including accessor functions)
 * via `.props` without needing a GPU, which is what this test reads.
 */

const SAMPLE: TourPathDatum = {
  legId: "leg-1",
  path: [
    [10.5, 60.1],
    [10.8, 60.3],
    [11.0, 60.5],
  ],
  color: [141, 191, 106],
  isPlaceholder: false,
  label: "Test leg",
};

describe("buildTourDeckLayers: altitude on the globe, none on the flat map", () => {
  it("defaults to the raw 2-D path (altitudeM omitted) -- the flat map's existing, correct behaviour", () => {
    const [layer] = buildTourDeckLayers([SAMPLE]);
    const getPath = pathAccessor(layer.props);
    expect(getPath(SAMPLE)).toBe(SAMPLE.path);
  });

  it("returns the raw 2-D path when altitudeM is explicitly 0", () => {
    const [layer] = buildTourDeckLayers([SAMPLE], 0);
    const getPath = pathAccessor(layer.props);
    expect(getPath(SAMPLE)).toBe(SAMPLE.path);
  });

  it("lifts EVERY point to 3-D with the given altitude as the z component", () => {
    const [layer] = buildTourDeckLayers([SAMPLE], TOUR_PATH_GLOBE_ALTITUDE_M);
    const getPath = pathAccessor(layer.props) as (
      d: TourPathDatum
    ) => Array<[number, number, number]>;
    const lifted = getPath(SAMPLE);

    expect(lifted).toHaveLength(SAMPLE.path.length);
    for (let i = 0; i < lifted.length; i++) {
      expect(lifted[i][0]).toBe(SAMPLE.path[i][0]);
      expect(lifted[i][1]).toBe(SAMPLE.path[i][1]);
      expect(lifted[i][2]).toBe(TOUR_PATH_GLOBE_ALTITUDE_M);
    }
    // Not a mutation of the original 2-D array -- the flat map's own copy
    // of this data (built once, shared between both map engines via
    // `extraLayers`) must stay untouched.
    expect(SAMPLE.path[0]).toHaveLength(2);
  });

  it("the globe altitude is non-zero -- a lift of 0 would silently reintroduce this exact bug", () => {
    expect(TOUR_PATH_GLOBE_ALTITUDE_M).toBeGreaterThan(0);
  });
});
