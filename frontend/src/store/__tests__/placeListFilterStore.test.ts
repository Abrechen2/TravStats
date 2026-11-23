import { beforeEach, describe, expect, it, vi } from "vitest";

describe("placeListFilterStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it("remembers the chosen lists across a reload", async () => {
    const first = await import("../placeListFilterStore");
    first.usePlaceListFilterStore.getState().toggle("list:macs");
    first.usePlaceListFilterStore.getState().toggle("curated:wonders");
    vi.resetModules();
    const second = await import("../placeListFilterStore");
    expect(second.usePlaceListFilterStore.getState().selection).toEqual([
      "list:macs",
      "curated:wonders",
    ]);
  });

  it("toggles a list off again and clears back to 'Alle Orte'", async () => {
    const { usePlaceListFilterStore: store } = await import("../placeListFilterStore");
    store.getState().toggle("list:macs");
    store.getState().toggle("list:macs");
    expect(store.getState().selection).toEqual([]);
    store.getState().toggle("list:a");
    store.getState().clear();
    expect(store.getState().selection).toEqual([]);
  });
});
