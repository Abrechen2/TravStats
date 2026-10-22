import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * „Aufgezeichnete Flugwege zeigen" (forgejo#312): off unless the user switched
 * it on, persisted in the shared map blob. The store reads storage once at
 * import, so each case imports a fresh copy.
 */
async function fresh() {
  vi.resetModules();
  return import("../recordedFlightPathsStore");
}

const KEY = "mapAppearance.v2";

describe("recordedFlightPathsStore", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("is off by default — the dashboard shows routes", async () => {
    const { useRecordedFlightPathsStore } = await fresh();
    expect(useRecordedFlightPathsStore.getState().show).toBe(false);
  });

  it("reads anything but a stored true as off", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ showRecordedFlightPaths: "yes" }));
    const { useRecordedFlightPathsStore } = await fresh();
    expect(useRecordedFlightPathsStore.getState().show).toBe(false);
  });

  it("persists a change into the shared blob and survives a reload", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ styleId: "satellite" }));
    const first = await fresh();
    first.useRecordedFlightPathsStore.getState().setShow(true);
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "{}")).toEqual({
      styleId: "satellite",
      showRecordedFlightPaths: true,
    });
    const second = await fresh();
    expect(second.useRecordedFlightPathsStore.getState().show).toBe(true);
  });
});
