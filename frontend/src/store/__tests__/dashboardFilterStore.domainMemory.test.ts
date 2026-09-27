import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const KEY = "dashboard.hiddenDomains";

async function freshStore() {
  vi.resetModules();
  return (await import("../dashboardFilterStore")).useDashboardFilterStore;
}

/**
 * Tester 2026-09-26: the "Alle" tab needs a domain filter the viewer can
 * switch and that is still set the next time they open the dashboard. The
 * choice is a per-viewer convenience, so it lives in this browser only.
 */
describe("dashboard domain filter memory", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("a domain hidden on one visit is still hidden on the next", async () => {
    const first = await freshStore();
    first.getState().setDomains(first.getState().domains.filter((d) => d !== "cruise"));

    const second = await freshStore();
    expect(second.getState().domains).not.toContain("cruise");
    expect(second.getState().domains).toContain("flight");
  });

  it("remembers what was hidden, so a domain added later starts visible", async () => {
    window.localStorage.setItem(KEY, JSON.stringify(["cruise"]));
    const store = await freshStore();
    expect(store.getState().domains).toContain("roadtrip");
    expect(store.getState().domains).not.toContain("cruise");
  });

  it("reset shows every domain again and forgets the choice", async () => {
    const store = await freshStore();
    store.getState().setDomains(["flight"]);
    store.getState().reset();
    const again = await freshStore();
    expect(again.getState().domains).toContain("cruise");
  });

  it("ignores a stored value it cannot read, and unknown keys in it", async () => {
    window.localStorage.setItem(KEY, "{not json");
    expect((await freshStore()).getState().domains).toContain("cruise");
    window.localStorage.setItem(KEY, JSON.stringify(["nonsense", 3]));
    expect((await freshStore()).getState().domains).toContain("cruise");
  });

  it("still works when the browser refuses storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const store = await freshStore();
    expect(store.getState().domains).toContain("flight");
    store.getState().setDomains(["flight"]);
    expect(store.getState().domains).toEqual(["flight"]);
  });
});
