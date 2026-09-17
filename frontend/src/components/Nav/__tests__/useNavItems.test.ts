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

import {
  useNavItems,
  isNodeActive,
  isPathActive,
  type NavGroup,
  type NavLeaf,
  type NavSection,
} from "../useNavItems";
import { useSettingsStore } from "../../../store/settingsStore";

function run() {
  return renderHook(() => useNavItems()).result.current;
}

function section(more: NavSection[], id: string): NavLeaf[] {
  return more.find((s) => s.id === id)?.items ?? [];
}

describe("useNavItems — primary destinations (round 4, E1)", () => {
  beforeEach(() => {
    authState.user = { isAdmin: false };
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
  });

  it("offers exactly Dashboard, Logbuch, Reisen and Statistik", () => {
    const { primary } = run();
    expect(primary.map((n) => n.id)).toEqual(["dashboard", "logbook", "trips", "stats"]);
  });

  it("points Dashboard at /dashboard, where the entry can actually be active", () => {
    const { primary } = run();
    const dash = primary.find((n) => n.id === "dashboard") as NavLeaf;
    expect(dash.path).toBe("/dashboard");
    expect(isNodeActive(dash, "/dashboard")).toBe(true);
    expect(isNodeActive(dash, "/flights")).toBe(false);
  });

  it("groups two enabled domains under a Logbuch node", () => {
    const { primary } = run();
    const logbuch = primary.find((n) => n.id === "logbook") as NavGroup;
    expect(logbuch.kind).toBe("group");
    expect(logbuch.children.map((c) => c.path)).toEqual(["/flights", "/cruises"]);
  });

  it("collapses Logbuch to a direct link with exactly one enabled domain", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    const { primary } = run();
    const logbuch = primary.find((n) => n.id === "logbook") as NavLeaf;
    expect(logbuch.kind).toBe("leaf");
    expect(logbuch.path).toBe("/flights");
  });

  it("omits the Logbuch node entirely with zero enabled domains", () => {
    useSettingsStore.setState({ enabledDomains: [] });
    const { primary } = run();
    expect(primary.some((n) => n.id === "logbook")).toBe(false);
  });

  it("marks a group active when any child route matches", () => {
    const { primary } = run();
    const logbuch = primary.find((n) => n.id === "logbook")!;
    expect(isNodeActive(logbuch, "/cruises/42")).toBe(true);
    expect(isNodeActive(logbuch, "/trips")).toBe(false);
  });
});

describe("useNavItems — Mehr › Sammlungen", () => {
  beforeEach(() => {
    authState.user = { isAdmin: false };
  });

  it("moves Erfolge from the header row into Sammlungen", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    const { primary, more } = run();
    expect(primary.some((n) => n.id === "achievements")).toBe(false);
    expect(section(more, "collections").map((i) => i.path)).toContain("/achievements");
  });

  // Built from flights alone; the entry depends on the flights domain.
  it("offers the passport whenever flights are on, whatever the beta switch says", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: false });
    expect(section(run().more, "collections").map((i) => i.path)).toContain("/passport");
  });

  it("omits the passport when flights are off", () => {
    useSettingsStore.setState({ enabledDomains: ["cruise"], betaFeaturesEnabled: true });
    expect(section(run().more, "collections").map((i) => i.path)).not.toContain("/passport");
  });

  it("offers Ortslisten while places are visible", () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "poi"] });
    expect(section(run().more, "collections").map((i) => i.path)).toContain("/places/lists");
  });

  it("omits Ortslisten while places are off", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    expect(section(run().more, "collections").map((i) => i.path)).not.toContain("/places/lists");
  });
});

describe("useNavItems — Mehr › Werkzeuge", () => {
  beforeEach(() => {
    authState.user = { isAdmin: false };
    useSettingsStore.setState({ enabledDomains: ["flight"] });
  });

  /**
   * T4 (2026-09-17 tester feedback): Posteingang was drawn TWICE — once as
   * the header's own icon with its badge (NavigationBar.tsx), once as a
   * leaf here — and Admin sat in "Mehr" rather than the account menu, where
   * settings and logout already live. Both leaves are gone from `tools`;
   * `UserMenu.admin.test.tsx` covers the admin link's new home.
   */
  it("carries no Posteingang leaf — it is the header icon, not a menu entry", () => {
    const tools = section(run().more, "tools");
    expect(tools.map((c) => c.id)).not.toContain("inbox");
  });

  it("carries no Admin leaf, for a normal user", () => {
    const tools = section(run().more, "tools");
    expect(tools.map((c) => c.id)).not.toContain("admin");
  });

  it("carries neither Posteingang nor Admin for an admin either", () => {
    authState.user = { isAdmin: true };
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
    const tools = section(run().more, "tools");
    expect(tools.map((c) => c.id)).not.toContain("inbox");
    expect(tools.map((c) => c.id)).not.toContain("admin");
  });

  it("still offers Parser (beta) to admins while the instance beta switch is on", () => {
    authState.user = { isAdmin: true };
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
    const tools = section(run().more, "tools");
    expect(tools.map((c) => c.path)).toEqual(["/parser"]);
    expect(tools[0].betaBadge).toBe(true);
  });

  // Owner decision 2026-09-05 (no. 10): the Beta badge has a gate behind it.
  it("leaves Werkzeuge empty for admins while the instance beta switch is off", () => {
    authState.user = { isAdmin: true };
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: false });
    expect(section(run().more, "tools")).toEqual([]);
  });

  it("draws no settings entry here — settings live behind the avatar", () => {
    const { primary, more } = run();
    const paths = [
      ...primary.flatMap((n) => (n.kind === "group" ? n.children : [n])).map((n) => n.path),
      ...more.flatMap((s) => s.items.map((i) => i.path)),
    ];
    expect(paths.some((p) => p.startsWith("/settings"))).toBe(false);
  });
});

describe("isPathActive", () => {
  it("matches a path and its children, not a sibling that merely shares a prefix", () => {
    expect(isPathActive("/places", "/places/lists")).toBe(true);
    expect(isPathActive("/trips", "/trips")).toBe(true);
    expect(isPathActive("/stats", "/statsx")).toBe(false);
  });
});
