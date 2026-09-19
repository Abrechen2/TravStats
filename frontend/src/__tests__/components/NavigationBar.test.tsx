import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

// Mock the auth store so we have a predictable logged-in user.
vi.mock("../../store/authStore", () => ({
  useAuthStore: () => ({
    user: { id: "u1", username: "tester", email: "t@t.de", isAdmin: false },
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
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
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

  it("no longer draws Bug, Support or System in the row", () => {
    renderNav();
    expect(screen.queryByRole("button", { name: /^Bug$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /nav\.support/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /nav\.system/i })).toBeNull();
  });

  it("reaches settings, the bug report and support through the account menu", () => {
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: /userMenu\.label/ }));
    expect(screen.getByRole("menuitem", { name: /dashboard:settings/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /diagnostic\.reportBug/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /support\.donate/ })).toBeTruthy();
  });
});
