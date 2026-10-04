import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAY_APPEARANCE,
  OVERLAY_SIZE_RANGE,
  OVERLAY_WIDTH_RANGE,
  overlayAppearanceFromStored,
} from "../overlayAppearance";
import { loadOverlayAppearance, saveMapAppearance } from "../../components/map/mapAppearance";

const KEY = "mapAppearance.v2";

/**
 * forgejo#198: tours, roadtrips, rail and rentals got their own panel sections.
 * Their values sit in the shared `mapAppearance.v2` blob, which every existing
 * user already has WITHOUT these keys — so absence must read as today's look.
 */
describe("overlayAppearanceFromStored", () => {
  it("reads an empty blob as today's look: every multiplier 1, the rental link shown", () => {
    expect(overlayAppearanceFromStored({})).toEqual(DEFAULT_OVERLAY_APPEARANCE);
    expect(DEFAULT_OVERLAY_APPEARANCE.rentalShowLine).toBe(true);
    expect(DEFAULT_OVERLAY_APPEARANCE.railLineWidth).toBe(1);
  });

  it("passes stored in-range values through", () => {
    const out = overlayAppearanceFromStored({
      tourLineWidth: 0.5,
      roadtripLineWidth: 1.8,
      roadtripStationSize: 0,
      railLineWidth: 1.4,
      railStationSize: 1.2,
      rentalLineWidth: 0.7,
      rentalMarkerSize: 1.6,
      rentalShowLine: false,
    });
    expect(out).toEqual({
      tourLineWidth: 0.5,
      roadtripLineWidth: 1.8,
      roadtripStationSize: 0,
      railLineWidth: 1.4,
      railStationSize: 1.2,
      rentalLineWidth: 0.7,
      rentalMarkerSize: 1.6,
      rentalShowLine: false,
    });
  });

  it("falls back to the default for a value that is not a finite number or a boolean", () => {
    const out = overlayAppearanceFromStored({
      railLineWidth: "thick",
      railStationSize: Number.NaN,
      rentalMarkerSize: null,
      rentalShowLine: "no",
    });
    expect(out.railLineWidth).toBe(1);
    expect(out.railStationSize).toBe(1);
    expect(out.rentalMarkerSize).toBe(1);
    expect(out.rentalShowLine).toBe(true);
  });

  it("clamps an out-of-range number into what the slider can show", () => {
    const out = overlayAppearanceFromStored({ railLineWidth: 9, rentalMarkerSize: -1 });
    expect(out.railLineWidth).toBe(OVERLAY_WIDTH_RANGE.max);
    expect(out.rentalMarkerSize).toBe(OVERLAY_SIZE_RANGE.min);
  });
});

describe("loadOverlayAppearance — the persisted blob", () => {
  beforeEach(() => window.localStorage.clear());

  it("reads the overlay fields back from the shared blob after a merge-write", () => {
    saveMapAppearance({ styleId: "dark" });
    saveMapAppearance({ railLineWidth: 1.5, rentalShowLine: false });
    expect(loadOverlayAppearance()).toMatchObject({ railLineWidth: 1.5, rentalShowLine: false });
    // The merge-write left the neighbouring field alone.
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "{}").styleId).toBe("dark");
  });

  it("defaults every field for a blob written before forgejo#198", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ flightRouteWidth: 1.2 }));
    expect(loadOverlayAppearance()).toEqual(DEFAULT_OVERLAY_APPEARANCE);
  });
});
