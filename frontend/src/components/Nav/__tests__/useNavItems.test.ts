import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// Predictable i18n: return the key so labels are assertable without locale files.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const authState: { user: { isAdmin: boolean } | null } = { user: { isAdmin: false } };
vi.mock("../../../store/authStore", () => ({
  useAuthStore: (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState),
}));

vi.unmock("../../../store/settingsStore");

import { useNavItems, isNodeActive, type NavGroup, type NavLeaf } from "../useNavItems";
import { useSettingsStore } from "../../../store/settingsStore";

function run(pending = 0, pathname = "/") {
  return renderHook(() => useNavItems(pending, pathname)).result.current;
}

describe("useNavItems — Logbuch grouping", () => {
  beforeEach(() => {
    authState.user = { isAdmin: false };
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
  });

  it("groups two enabled domains under a Logbuch node", () => {
    const { center } = run();
    const logbuch = center.find((n) => n.id === "logbook") as NavGroup;
    expect(logbuch.kind).toBe("group");
    expect(logbuch.children.map((c) => c.path)).toEqual(["/flights", "/cruises"]);
  });

  it("collapses Logbuch to a direct link with exactly one enabled domain", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    const { center } = run();
    const logbuch = center.find((n) => n.id === "logbook") as NavLeaf;
    expect(logbuch.kind).toBe("leaf");
    expect(logbuch.path).toBe("/flights");
    expect(logbuch.label).toBe("common:domain.flight");
  });

  it("omits the Logbuch node entirely with zero enabled domains", () => {
    useSettingsStore.setState({ enabledDomains: [] });
    const { center } = run();
    expect(center.some((n) => n.id === "logbook")).toBe(false);
  });

  it("keeps Reisen a top-level sibling", () => {
    const { center } = run();
    expect(center.some((n) => n.kind === "leaf" && n.path === "/trips")).toBe(true);
  });
});

describe("useNavItems — System group", () => {
  beforeEach(() => {
    authState.user = { isAdmin: false };
    useSettingsStore.setState({ enabledDomains: ["flight"] });
  });

  it("collapses to a direct Einstellungen link for a non-admin with zero pending updates", () => {
    const { system } = run(0, "/");
    expect(system.kind).toBe("leaf");
    expect((system as NavLeaf).path).toBe("/settings");
  });

  it("shows the Updates entry with badge when pending updates exist", () => {
    const { system } = run(3, "/");
    expect(system.kind).toBe("group");
    const updates = (system as NavGroup).children.find((c) => c.path === "/pending-updates");
    expect(updates?.badge).toBe(3);
    expect(updates?.warn).toBe(true);
    expect((system as NavGroup).badge).toBe(3);
  });

  it("shows the Updates entry with zero count while ON the pending-updates route", () => {
    const { system } = run(0, "/pending-updates");
    expect(system.kind).toBe("group");
    expect(
      (system as NavGroup).children.some((c) => c.path === "/pending-updates")
    ).toBe(true);
  });

  it("adds Admin and Parser (beta) for admins only", () => {
    authState.user = { isAdmin: true };
    const { system } = run(0, "/");
    const g = system as NavGroup;
    expect(g.kind).toBe("group");
    expect(g.children.map((c) => c.path)).toEqual(["/settings", "/admin", "/parser"]);
    expect(g.children.find((c) => c.path === "/parser")?.betaBadge).toBe(true);
  });
});

describe("isNodeActive", () => {
  it("marks a group active when any child route matches", () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
    const { center } = run(0, "/cruises/42");
    const logbuch = center.find((n) => n.id === "logbook")!;
    expect(isNodeActive(logbuch, "/cruises/42")).toBe(true);
    expect(isNodeActive(logbuch, "/trips")).toBe(false);
  });

  it("dashboard leaf is active only on exact root", () => {
    const { center } = run(0, "/");
    const dash = center.find((n) => n.id === "dashboard")!;
    expect(isNodeActive(dash, "/")).toBe(true);
    expect(isNodeActive(dash, "/flights")).toBe(false);
  });
});
