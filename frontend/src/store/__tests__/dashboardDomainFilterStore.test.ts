import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDashboardDomainFilterStore } from "../dashboardDomainFilterStore";
import { HIDDEN_DOMAINS_STORAGE_KEY } from "../../shared/dashboardDomainFilter";

describe("dashboardDomainFilterStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useDashboardDomainFilterStore.setState({ hidden: new Set(), linkHidden: null });
  });

  it("toggling a domain hides it and persists the hidden set", () => {
    useDashboardDomainFilterStore.getState().toggle("cruise");
    expect(useDashboardDomainFilterStore.getState().hidden.has("cruise")).toBe(true);

    const raw = window.localStorage.getItem(HIDDEN_DOMAINS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "[]")).toEqual(["cruise"]);
  });

  it("toggling the same domain twice shows it again and persists that too", () => {
    useDashboardDomainFilterStore.getState().toggle("poi");
    useDashboardDomainFilterStore.getState().toggle("poi");
    expect(useDashboardDomainFilterStore.getState().hidden.has("poi")).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(HIDDEN_DOMAINS_STORAGE_KEY) ?? "[]")).toEqual([]);
  });

  // A page reload constructs a fresh module instance, which reads its
  // initial state from storage at import time — `vi.resetModules` plus a
  // dynamic re-import is what actually exercises that code path, rather than
  // reading the same in-memory store back (which would pass even if nothing
  // were ever written to storage at all).
  it("a hidden domain survives a reload", async () => {
    useDashboardDomainFilterStore.getState().toggle("lodging");

    vi.resetModules();
    const fresh = await import("../dashboardDomainFilterStore");
    expect(fresh.useDashboardDomainFilterStore.getState().hidden.has("lodging")).toBe(true);
  });

  it("positive control — an empty storage reload shows every domain", async () => {
    window.localStorage.clear();
    vi.resetModules();
    const fresh = await import("../dashboardDomainFilterStore");
    expect(fresh.useDashboardDomainFilterStore.getState().hidden.size).toBe(0);
  });

  it("showNone hides every domain, showAll clears it", () => {
    useDashboardDomainFilterStore.getState().showNone();
    expect(useDashboardDomainFilterStore.getState().hidden.size).toBe(9);
    useDashboardDomainFilterStore.getState().showAll();
    expect(useDashboardDomainFilterStore.getState().hidden.size).toBe(0);
  });

  it("isolate hides every domain except the one named", () => {
    useDashboardDomainFilterStore.getState().isolate("tour");
    const hidden = useDashboardDomainFilterStore.getState().hidden;
    expect(hidden.has("tour")).toBe(false);
    expect(hidden.has("flight")).toBe(true);
    expect(hidden.has("roadtrip")).toBe(true);
    expect(hidden.has("rail")).toBe(true);
    expect(hidden.has("rental")).toBe(true);
    expect(hidden.has("bus")).toBe(true);
    expect(hidden.size).toBe(8);
  });

  it("a shared link's selection does not touch storage until adopted", () => {
    useDashboardDomainFilterStore.getState().enterLink(new Set(["flight"]));
    expect(useDashboardDomainFilterStore.getState().linkHidden?.has("cruise")).toBe(true);
    expect(useDashboardDomainFilterStore.getState().linkHidden?.has("flight")).toBe(false);
    // Own storage is untouched — the sender's choice is not the reader's.
    expect(window.localStorage.getItem(HIDDEN_DOMAINS_STORAGE_KEY)).toBeNull();

    useDashboardDomainFilterStore.getState().adoptLink();
    expect(useDashboardDomainFilterStore.getState().linkHidden).toBeNull();
    expect(useDashboardDomainFilterStore.getState().hidden.has("flight")).toBe(false);
    expect(useDashboardDomainFilterStore.getState().hidden.has("cruise")).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(HIDDEN_DOMAINS_STORAGE_KEY) ?? "[]")).toContain(
      "cruise"
    );
  });

  it("toggling while viewing a link edits the link, not the reader's own storage", () => {
    useDashboardDomainFilterStore.getState().enterLink(new Set(["flight", "cruise"]));
    useDashboardDomainFilterStore.getState().toggle("flight");
    expect(useDashboardDomainFilterStore.getState().linkHidden?.has("flight")).toBe(true);
    expect(useDashboardDomainFilterStore.getState().hidden.size).toBe(0);
    expect(window.localStorage.getItem(HIDDEN_DOMAINS_STORAGE_KEY)).toBeNull();
  });

  it("exitLink drops the link view without changing the reader's own selection", () => {
    useDashboardDomainFilterStore.getState().toggle("poi");
    useDashboardDomainFilterStore.getState().enterLink(new Set());
    useDashboardDomainFilterStore.getState().exitLink();
    expect(useDashboardDomainFilterStore.getState().linkHidden).toBeNull();
    expect(useDashboardDomainFilterStore.getState().hidden.has("poi")).toBe(true);
  });
});
