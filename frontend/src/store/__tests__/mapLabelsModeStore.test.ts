import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The label reveal moved from two maps' component state into one store
 * (forgejo#320), because the station labels of rail, bus and ferry are built
 * outside the map. The store reads storage once at import, so each case
 * imports a fresh copy.
 */
async function fresh() {
  vi.resetModules();
  return import("../mapLabelsModeStore");
}

const KEY = "mapAppearance.v2";

describe("mapLabelsModeStore", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("starts from the stored mode", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ labelsMode: "all" }));
    const { useMapLabelsModeStore } = await fresh();
    expect(useMapLabelsModeStore.getState().mode).toBe("all");
  });

  it("reads a missing or foreign stored value as the default", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ labelsMode: "everything" }));
    const { useMapLabelsModeStore, loadLabelsMode } = await fresh();
    expect(useMapLabelsModeStore.getState().mode).toBe("important");
    window.localStorage.clear();
    expect(loadLabelsMode()).toBe("important");
  });

  it("persists a change into the shared blob without touching the other keys", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ styleId: "satellite" }));
    const { useMapLabelsModeStore } = await fresh();
    useMapLabelsModeStore.getState().setMode("off");
    expect(useMapLabelsModeStore.getState().mode).toBe("off");
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "{}")).toEqual({
      styleId: "satellite",
      labelsMode: "off",
    });
  });
});
