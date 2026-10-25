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

const travTrack = vi.hoisted(() => ({ visible: false }));
vi.mock("../../../hooks/useTravTrackVisible", () => ({
  useTravTrackVisible: () => travTrack.visible,
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

  // TravTrack plan T6: the rule lives in `useTravTrackVisible`; the menu follows it.
  it("offers Track in Sammlungen exactly when TravTrack is offered to the account", () => {
    travTrack.visible = false;
    expect(section(run().more, "collections").map((i) => i.path)).not.toContain("/track");
    travTrack.visible = true;
    expect(section(run().more, "collections").map((i) => i.path)).toContain("/track");
    travTrack.visible = false;
  });

  // forgejo#137: a note needs no domain, so the entry does not either.
  it("offers Notizen without flights", () => {
    useSettingsStore.setState({ enabledDomains: ["cruise"] });
    expect(section(run().more, "collections").map((i) => i.path)).toContain("/notes");
  });

  it("offers Notizen with every domain off", () => {
    useSettingsStore.setState({ enabledDomains: [] });
    expect(section(run().more, "collections").map((i) => i.path)).toContain("/notes");
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

  // Dein Jahr (forgejo#53) sits beside the passport, under the same condition:
  // it is built from flights, so an entry leading to a page that explains why
  // it is empty is worse than no entry.
  it("offers the year in review whenever flights are on", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: false });
    const collections = section(run().more, "collections");
    expect(collections.map((i) => i.path)).toContain("/wrapped");
    // Beside the passport, not at the far end of the list.
    const paths = collections.map((i) => i.path);
    expect(paths.indexOf("/wrapped")).toBe(paths.indexOf("/passport") + 1);
  });

  it("omits the year in review when flights are off", () => {
    useSettingsStore.setState({ enabledDomains: ["cruise"], betaFeaturesEnabled: true });
    expect(section(run().more, "collections").map((i) => i.path)).not.toContain("/wrapped");
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

  /**
   * The Parser left the beta registry on 2026-09-17 (owner decision, main):
   * the gate asked for the template and regex parsers to be measured against
   * the sample set, and they were. So it is offered to admins whatever the
   * instance beta switch says, and carries no badge — a badge without a gate
   * behind it is the thing owner decision no. 10 of 2026-09-05 forbids.
   *
   * This used to read `expect(tools[0].betaBadge).toBeUndefined()`. The field
   * was removed from `NavLeaf` on 2026-09-20 (owner ruling, beta audit of
   * 2026-09-19): nothing in the tree ever set it, so the two renderers that
   * read it drew a badge that could not appear, and an optional flag nobody
   * assigns is an invitation to assign it. The assertion is kept in the shape
   * it can still have — the nav item carries no badge field at all.
   */
  it("offers Parser to admins while the instance beta switch is on, without a badge", () => {
    authState.user = { isAdmin: true };
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
    const tools = section(run().more, "tools");
    // The encrypted share (rework 2026-10-16) joins it behind its own beta key.
    expect(tools.map((c) => c.path)).toEqual(["/parser", "/encrypted-share"]);
    expect(Object.keys(tools[0])).not.toContain("betaBadge");
  });

  it("offers Parser to admins with the switch OFF too — there is no gate any more", () => {
    authState.user = { isAdmin: true };
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: false });
    expect(section(run().more, "tools").map((c) => c.path)).toEqual(["/parser"]);
  });

  it("offers a normal user only the encrypted share in Werkzeuge while the switch is on", () => {
    authState.user = { isAdmin: false };
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
    expect(section(run().more, "tools").map((c) => c.path)).toEqual(["/encrypted-share"]);
  });

  it("leaves Werkzeuge empty for a normal user with the switch OFF", () => {
    authState.user = { isAdmin: false };
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

describe("comparison and encrypted share (rework 2026-10-16)", () => {
  beforeEach(() => {
    authState.user = { isAdmin: false };
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
  });

  it("gives the comparison its own icon, apart from the achievements trophy", () => {
    const collections = section(run().more, "collections");
    expect(collections.find((l) => l.id === "comparison")).toMatchObject({
      path: "/compare",
      icon: "users",
    });
    expect(collections.find((l) => l.id === "achievements")?.icon).toBe("trophy");
    const ids = collections.map((l) => l.id);
    expect(ids.indexOf("comparison")).toBe(ids.indexOf("wrapped") + 1);
  });

  it("offers the encrypted share as a tool behind its own key", () => {
    expect(section(run().more, "tools").find((l) => l.id === "encrypted-share")).toMatchObject({
      path: "/encrypted-share",
      icon: "key-round",
      label: "encryptedShare:nav",
    });
  });

  it("hides both while the beta switch is off", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    const all = run().more.flatMap((s) => s.items.map((l) => l.id));
    expect(all).not.toContain("comparison");
    expect(all).not.toContain("encrypted-share");
  });
});
