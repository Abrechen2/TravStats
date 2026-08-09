/**
 * globeChrome — persistence for the two globe-only switches (auto-rotation,
 * day/night). Found by the 2026-08-03 persistence audit: every other map
 * setting survived a reload except these.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadGlobeChrome, saveGlobeChrome } from "./globeChrome";

describe("globeChrome", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns an empty object when nothing is stored (defaults stay with the caller)", () => {
    expect(loadGlobeChrome()).toEqual({});
  });

  it("round-trips both switches", () => {
    saveGlobeChrome({ autoRotate: true, showNight: false });
    expect(loadGlobeChrome()).toEqual({ autoRotate: true, showNight: false });
  });

  it("ignores a corrupt blob instead of throwing", () => {
    window.localStorage.setItem("globeChrome.v1", "{not json");
    expect(loadGlobeChrome()).toEqual({});
  });

  it("drops non-boolean values so a tampered blob cannot poison the state", () => {
    window.localStorage.setItem(
      "globeChrome.v1",
      JSON.stringify({ autoRotate: "yes", showNight: false })
    );
    expect(loadGlobeChrome()).toEqual({ autoRotate: undefined, showNight: false });
  });
});
