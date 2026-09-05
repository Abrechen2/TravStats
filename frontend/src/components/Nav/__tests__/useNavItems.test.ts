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

function run(pending = 0) {
  return renderHook(() => useNavItems(pending)).result.current;
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

  // Owner rule 2026-09-05: the Posteingang is reachable from the menu at all
  // times. Until then the entry existed only while something was open, so an
  // empty inbox had no way in from the UI.
  it("keeps the Posteingang in the System group when nothing is open — without badge or warning", () => {
    const { system } = run(0);
    expect(system.kind).toBe("group");
    const g = system as NavGroup;
    expect(g.children.map((c) => c.path)).toEqual(["/settings", "/pending-updates"]);
    const inbox = g.children.find((c) => c.path === "/pending-updates") as NavLeaf;
    expect(inbox.badge).toBeUndefined();
    expect(inbox.warn).toBeUndefined();
    expect(g.badge).toBeUndefined();
  });

  it("shows the Posteingang with badge and warning when something is open", () => {
    const { system } = run(3);
    expect(system.kind).toBe("group");
    const updates = (system as NavGroup).children.find((c) => c.path === "/pending-updates");
    expect(updates?.badge).toBe(3);
    expect(updates?.warn).toBe(true);
    expect((system as NavGroup).badge).toBe(3);
  });

  it("adds Admin and Parser (beta) for admins only", () => {
    authState.user = { isAdmin: true };
    const { system } = run(0);
    const g = system as NavGroup;
    expect(g.kind).toBe("group");
    expect(g.children.map((c) => c.path)).toEqual([
      "/settings",
      "/pending-updates",
      "/admin",
      "/parser",
    ]);
    expect(g.children.find((c) => c.path === "/parser")?.betaBadge).toBe(true);
  });
});

describe("isNodeActive", () => {
  it("marks a group active when any child route matches", () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
    const { center } = run(0);
    const logbuch = center.find((n) => n.id === "logbook")!;
    expect(isNodeActive(logbuch, "/cruises/42")).toBe(true);
    expect(isNodeActive(logbuch, "/trips")).toBe(false);
  });

  it("dashboard leaf is active only on exact root", () => {
    const { center } = run(0);
    const dash = center.find((n) => n.id === "dashboard")!;
    expect(isNodeActive(dash, "/")).toBe(true);
    expect(isNodeActive(dash, "/flights")).toBe(false);
  });
});
