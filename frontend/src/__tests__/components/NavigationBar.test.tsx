import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mock the lib/api module: keep everything real except for the endpoints
// NavigationBar calls so the tests do not hit the network.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    settingsApi: {
      ...actual.settingsApi,
      update: vi.fn().mockResolvedValue(undefined),
    },
    pendingUpdatesApi: {
      ...actual.pendingUpdatesApi,
      getAll: vi.fn().mockResolvedValue({ count: 0, updates: [] }),
    },
  };
});

// Mock the auth store so we have a predictable logged-in user; `isAdmin` is
// switched per test.
const authState = vi.hoisted(() => ({ isAdmin: false }));
vi.mock("../../store/authStore", () => ({
  useAuthStore: () => ({
    user: { id: "u1", username: "tester", email: "t@t.de", isAdmin: authState.isAdmin },
    logout: vi.fn().mockResolvedValue(undefined),
  }),
}));

// DiagnosticExportModal does a lot of work we don't need here.
vi.mock("../../components/DiagnosticExportModal", () => ({
  default: () => null,
}));

// NavigationBar/DashboardPage ask for the running version on mount; the request
// escaped the test and failed silently (forgejo#110).
vi.mock("@/lib/api/version", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/version")>();
  return {
    ...actual,
    versionApi: {
      ...actual.versionApi,
      get: vi.fn().mockResolvedValue({ version: "0.0.0-test", updateAvailable: false }),
    },
  };
});

// The open-flag badge polls on mount; unmocked it reached the network.
vi.mock("@/lib/api/dataQualityFlags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/dataQualityFlags")>();
  return {
    ...actual,
    dataQualityFlagsApi: { ...actual.dataQualityFlagsApi, getAll: vi.fn().mockResolvedValue([]) },
  };
});

// The trip-suggestion count joins the badge (2026-09-26); unmocked it reaches
// the network. Hoisted so a case can put suggestions in the inbox.
const tripSuggestionCount = vi.hoisted(() => ({ value: 0 }));
vi.mock("@/lib/api/tripSuggestions", () => ({
  tripSuggestionsApi: { count: vi.fn(async () => tripSuggestionCount.value) },
}));

// Shared trips are the fourth source (2026-10-09). `fail` makes the count
// request reject, to prove one failing source does not zero the badge.
const sharingCount = vi.hoisted(() => ({ value: 0, fail: false }));
vi.mock("@/lib/api/sharing", () => ({
  sharingApi: {
    inboxCount: vi.fn(async () => {
      if (sharingCount.fail) throw new Error("sharing count down");
      return sharingCount.value;
    }),
  },
}));

// The two area rules (phase 5): each hook is the one home of its rule and is
// tested there; here they are switches. Off by default, as on most instances.
const areaVisible = vi.hoisted(() => ({ plan: false, track: false }));
vi.mock("../../hooks/useTravPlanVisible", () => ({
  useTravPlanVisible: () => areaVisible.plan,
}));
vi.mock("../../hooks/useTravTrackVisible", () => ({
  useTravTrackVisible: () => areaVisible.track,
}));

// Use the real settingsStore so useEnabledDomains reads actual state.
vi.unmock("../../store/settingsStore");

import NavigationBar from "../../components/NavigationBar";
import { useSettingsStore } from "../../store/settingsStore";

// NOTE: src/__tests__/setup.ts globally mocks react-i18next with an identity
// `t: (key) => key` (verified: no test file in this repo unmocks it). Labels
// therefore render as raw "namespace:key" strings, not localized text — the
// same convention the pre-existing domain-gating tests and useNavItems.test.ts
// rely on. Assertions below match the raw keys (case-insensitively) instead
// of the localized "Logbuch"/"Einstellungen" strings a real i18n run would
// produce. Donate/Star route through t() since UAT finding C13 (the support
// menu spoke English in the German UI), so they match raw keys now too.
describe("NavigationBar — round-4 header", () => {
  beforeEach(() => {
    authState.isAdmin = false;
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
    tripSuggestionCount.value = 0;
    sharingCount.value = 0;
    sharingCount.fail = false;
    areaVisible.plan = false;
    areaVisible.track = false;
  });

  function renderNav(path = "/dashboard") {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <NavigationBar />
      </MemoryRouter>
    );
  }

  it("renders a Logbuch dropdown with both domains when two are enabled", () => {
    renderNav();
    fireEvent.click(screen.getAllByRole("button", { name: /nav\.logbook/i })[0]);
    expect(screen.getByRole("menuitem", { name: /domain\.flight/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /domain\.cruise/i })).toBeTruthy();
  });

  it("collapses Logbuch to a direct link with one enabled domain", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    renderNav();
    expect(screen.queryByRole("button", { name: /nav\.logbook/i })).toBeNull();
    expect(screen.getAllByRole("link", { name: /domain\.flight/i }).length).toBeGreaterThan(0);
  });

  it("marks the current primary destination", () => {
    renderNav("/trips");
    const trips = screen.getByRole("link", { name: "trips:tab" });
    expect(trips.getAttribute("aria-current")).toBe("page");
  });

  // T4 (2026-09-17 tester feedback): Posteingang left "Mehr" — it is the
  // header's own icon below (and only there now), so drawing it a second
  // time here duplicated it.
  it("keeps Erfolge under Mehr, without a second Posteingang entry", () => {
    renderNav();
    fireEvent.click(screen.getAllByRole("button", { name: /nav\.more/i })[0]);
    expect(screen.getByRole("menuitem", { name: /dashboard:achievements/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /dataQuality:inbox\.nav/ })).toBeNull();
  });

  // Owner rule 2026-09-05: the Posteingang is reachable at all times — as an
  // icon in the row as well, even with nothing open.
  it("shows the Posteingang icon with no dot when nothing is open", () => {
    renderNav();
    const inbox = screen.getByRole("link", { name: "dataQuality:inbox.nav" });
    expect(inbox.getAttribute("href")).toBe("/pending-updates");
    expect(screen.queryByTestId("inbox-dot")).toBeNull();
  });

  it("counts open trip suggestions in the Posteingang badge", async () => {
    tripSuggestionCount.value = 3;
    renderNav();
    expect(await screen.findByRole("link", { name: "dataQuality:inbox.nav (3)" })).toBeTruthy();
  });

  it("adds open sharing requests and notices to the Posteingang badge", async () => {
    tripSuggestionCount.value = 3;
    sharingCount.value = 2;
    renderNav();
    expect(await screen.findByRole("link", { name: "dataQuality:inbox.nav (5)" })).toBeTruthy();
  });

  it("keeps the other sources in the badge when the sharing count fails", async () => {
    tripSuggestionCount.value = 3;
    sharingCount.fail = true;
    renderNav();
    expect(await screen.findByRole("link", { name: "dataQuality:inbox.nav (3)" })).toBeTruthy();
  });

  it("no longer draws Bug, Support or System in the row", () => {
    renderNav();
    expect(screen.queryByRole("button", { name: /^Bug$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /nav\.support/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /nav\.system/i })).toBeNull();
  });

  it("reaches settings, the bug report and support through the account menu", () => {
    authState.isAdmin = true;
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: /userMenu\.label/ }));
    expect(screen.getByRole("menuitem", { name: /dashboard:settings/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /diagnostic\.reportBug/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /support\.donate/ })).toBeTruthy();
  });

  // Owner 2026-09-25: the diagnostic bundle is admins-only on the server, so
  // an ordinary account must not be offered an entry that can only fail.
  it("offers no diagnostic bug report to an ordinary account", () => {
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: /userMenu\.label/ }));
    expect(screen.getByRole("menuitem", { name: /dashboard:settings/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /diagnostic\.reportBug/ })).toBeNull();
  });
});

// TravTrack plan, phase 5 — header variant B: "Trav" + the area words, a
// divider, and the ACTIVE area's menu. Labels are raw keys (see the note above).
describe("NavigationBar — area switch (variant B)", () => {
  beforeEach(() => {
    authState.isAdmin = false;
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
    areaVisible.plan = true;
    areaVisible.track = true;
  });

  function renderAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <NavigationBar />
      </MemoryRouter>
    );
  }

  const areaNav = () => screen.getByRole("navigation", { name: /nav\.areas\.label/ });
  const word = (area: string) =>
    within(areaNav()).getByRole("link", { name: new RegExp(`areas\\.${area}`) });
  const mainNav = () => screen.getByRole("navigation", { name: /nav\.main/ });

  it("spells the logo as the words of the visible areas, each leading to its area", () => {
    renderAt("/dashboard");
    expect(
      within(areaNav())
        .getAllByRole("link")
        .map((a) => a.getAttribute("href"))
    ).toEqual(["/dashboard", "/plan", "/track"]);
  });

  it.each([
    ["/dashboard", "stats"],
    ["/trips", "stats"],
    ["/plan", "plan"],
    ["/plan/abc/budget", "plan"],
    ["/track", "track"],
    ["/track/explored", "track"],
  ])("on %s the %s word is the active one, in its area colour", (path, area) => {
    renderAt(path);
    for (const id of ["stats", "plan", "track"]) {
      const link = word(id);
      if (id === area) {
        expect(link.getAttribute("aria-current")).toBe("true");
        expect(link.style.color).toBe(`var(--area-${id})`);
        expect(link.style.borderBottom).toContain(`var(--area-${id})`);
      } else {
        expect(link.getAttribute("aria-current")).toBeNull();
      }
    }
  });

  it("hides the word of an area that is not visible", () => {
    areaVisible.plan = false;
    renderAt("/dashboard");
    expect(within(areaNav()).queryByRole("link", { name: /areas\.plan/ })).toBeNull();
    expect(word("track")).toBeTruthy();
  });

  it("reads TravStats as before, with no words or divider, when neither area is visible", () => {
    areaVisible.plan = false;
    areaVisible.track = false;
    renderAt("/dashboard");
    expect(screen.queryByRole("navigation", { name: /nav\.areas\.label/ })).toBeNull();
    expect(screen.queryByTestId("area-divider")).toBeNull();
    expect(screen.getByRole("link", { name: /accessibility\.home/ }).textContent).toContain("TRAV");
  });

  it("shows Track's own menu on /track, without Mehr or the Stats entries", () => {
    renderAt("/track/explored");
    const nav = mainNav();
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href"))
    ).toEqual(["/track", "/track/explored", "/track/months", "/track/stays", "/track/imports"]);
    expect(within(nav).queryByRole("button", { name: /nav\.more/ })).toBeNull();
    const current = within(nav).getByRole("link", { name: /track:menu\.explored/ });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.style.boxShadow).toContain("var(--area-track)");
    expect(screen.getByTestId("area-divider")).toBeTruthy();
  });

  it("marks Karte on a day of the track", () => {
    renderAt("/track/2026-10-12");
    const map = within(mainNav()).getByRole("link", { name: /track:menu\.map/ });
    expect(map.getAttribute("aria-current")).toBe("page");
  });

  it("shows Plan's menu on /plan, the configuration for admins only", () => {
    renderAt("/plan");
    expect(
      within(mainNav())
        .getAllByRole("link")
        .map((a) => a.getAttribute("href"))
    ).toEqual(["/plan"]);
  });

  it("keeps today's menu on Stats, and Track is no longer under Mehr", () => {
    renderAt("/dashboard");
    const nav = mainNav();
    expect(within(nav).getByRole("link", { name: /dashboard:title/ })).toBeTruthy();
    fireEvent.click(within(nav).getByRole("button", { name: /nav\.more/ }));
    expect(screen.queryByRole("menuitem", { name: /track:title/ })).toBeNull();
  });

  it("folds the area's menu into the phone menu button", () => {
    renderAt("/track");
    fireEvent.click(screen.getByRole("button", { name: /nav\.menu/ }));
    expect(screen.getByRole("menuitem", { name: /track:menu\.imports/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /achievements/ })).toBeNull();
  });
});
