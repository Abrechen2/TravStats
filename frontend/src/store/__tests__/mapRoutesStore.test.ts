import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function fresh() {
  vi.resetModules();
  const store = await import("../mapRoutesStore");
  const registry = await import("../../lib/webPrefs/registry");
  const section = registry.WEB_PREF_SECTIONS.find((s) => s.name === "mapAppearance")!;
  return { ...store, section };
}
const blob = () => JSON.parse(window.localStorage.getItem("mapAppearance.v2") ?? "{}");

describe("route switches are persisted in the account-synced mapAppearance blob", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("start all on, so no existing map changes", async () => {
    const { useMapRoutesStore } = await fresh();
    expect(Object.values(useMapRoutesStore.getState().visible).every(Boolean)).toBe(true);
  });

  it("writes on change, keeps the other domains, and is restored by a fresh load", async () => {
    const first = await fresh();
    first.useMapRoutesStore.getState().setVisible("flight", false);
    expect(blob().routesVisible.flight).toBe(false);
    expect(blob().routesVisible.cruise).toBe(true);
    const second = await fresh();
    expect(second.useMapRoutesStore.getState().visible.flight).toBe(false);
    expect(second.useMapRoutesStore.getState().visible.rail).toBe(true);
  });

  it("travels with the account: it is in what the section reads, not in the device-only keys", async () => {
    const { useMapRoutesStore, section } = await fresh();
    useMapRoutesStore.getState().setVisible("rail", false);
    expect(section.read()).toMatchObject({ routesVisible: { rail: false } });
    expect(section.isDefault?.(section.read())).toBe(false);
  });

  it("is handed the server's value when the section is applied (another device changed it)", async () => {
    const { useMapRoutesStore, section } = await fresh();
    section.apply({ routesVisible: { flight: false, ferry: false } });
    expect(useMapRoutesStore.getState().visible.flight).toBe(false);
    expect(useMapRoutesStore.getState().visible.ferry).toBe(false);
    expect(useMapRoutesStore.getState().visible.cruise).toBe(true);
    section.apply({});
    expect(useMapRoutesStore.getState().visible.flight).toBe(true);
  });
});
