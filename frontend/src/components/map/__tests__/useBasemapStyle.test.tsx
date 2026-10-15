import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useBasemapStyle } from "../useBasemapStyle";
import { MAP_APPEARANCE_KEY, saveMapAppearance } from "../mapAppearance";
import { resolveFlatStyle } from "../basemapStyles";
import { useWebPrefsEpochStore } from "../../../lib/webPrefs/prefEvents";
beforeEach(() => localStorage.clear());
describe("shared detail map style", () => {
  it("follows local choices and preserves other preferences", () => {
    saveMapAppearance({ styleId: "voyager", flightRouteWidth: 4 });
    const { result } = renderHook(useBasemapStyle);
    expect(result.current).toBe(resolveFlatStyle("voyager"));
    act(() => saveMapAppearance({ styleId: "light" }));
    expect(result.current).toBe(resolveFlatStyle("light"));
    expect(JSON.parse(localStorage.getItem(MAP_APPEARANCE_KEY)!)).toMatchObject({
      flightRouteWidth: 4,
    });
  });
  it("follows account sync and storage events for raster maps", () => {
    const { result } = renderHook(useBasemapStyle);
    expect(result.current).toBe(resolveFlatStyle("dark"));
    act(() => {
      localStorage.setItem(MAP_APPEARANCE_KEY, JSON.stringify({ styleId: "satellite" }));
      useWebPrefsEpochStore.getState().bump("mapAppearance");
    });
    expect(result.current).toBe(resolveFlatStyle("satellite"));
    act(() => {
      localStorage.setItem(MAP_APPEARANCE_KEY, JSON.stringify({ styleId: "osm" }));
      window.dispatchEvent(new StorageEvent("storage", { key: MAP_APPEARANCE_KEY }));
    });
    expect(result.current).toBe(resolveFlatStyle("osm"));
  });
  it("falls back for invalid saved values", () => {
    localStorage.setItem(MAP_APPEARANCE_KEY, JSON.stringify({ styleId: "removed" }));
    expect(renderHook(useBasemapStyle).result.current).toBe(resolveFlatStyle("dark"));
  });
});
