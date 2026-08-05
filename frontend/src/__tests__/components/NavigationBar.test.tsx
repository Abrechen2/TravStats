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
// produce. Donate/Star/Discord/Bug stay literal since those labels are
// hardcoded English strings, never routed through t().
describe("NavigationBar grouped navigation", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
  });

  function renderNav() {
    return render(
      <MemoryRouter>
        <NavigationBar />
      </MemoryRouter>
    );
  }

  it("renders a Logbuch dropdown with both domains when two are enabled", () => {
    renderNav();
    const trigger = screen.getAllByRole("button", { name: /nav\.logbook/i })[0];
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: /domain\.flight/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /domain\.cruise/i })).toBeTruthy();
  });

  it("collapses Logbuch to a direct link with one enabled domain", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    renderNav();
    expect(screen.queryByRole("button", { name: /nav\.logbook/i })).toBeNull();
    expect(screen.getAllByRole("link", { name: /domain\.flight/i }).length).toBeGreaterThan(0);
  });

  it("collapses System to a direct Einstellungen link for non-admin without updates", () => {
    renderNav();
    expect(screen.queryByRole("button", { name: /nav\.system/i })).toBeNull();
    expect(
      screen.getAllByRole("link", { name: /dashboard:settings/i }).length
    ).toBeGreaterThan(0);
  });

  it("keeps the Bug button visible and groups support links in a dropdown", () => {
    renderNav();
    expect(screen.getByRole("button", { name: /Bug/ })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /nav\.support/i })[0]);
    expect(screen.getByRole("menuitem", { name: /Donate/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Star/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Discord/ })).toBeTruthy();
  });

  it("marks the collapsed System settings link active on /settings", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <NavigationBar />
      </MemoryRouter>
    );
    const settingsLinks = screen.getAllByRole("link", { name: /dashboard:settings/i });
    expect(settingsLinks.some((l) => l.getAttribute("aria-current") === "page")).toBe(true);
  });
});

describe("NavigationBar mobile panel", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
  });

  it("renders Logbuch as a labelled group with indented domain links", () => {
    render(
      <MemoryRouter>
        <NavigationBar />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByLabelText(/toggleMenu/i));
    // group label is plain text (not a button) in the panel; the desktop
    // NavDropdown trigger also matches the raw key, so assert at least one hit
    expect(screen.getAllByText(/nav\.logbook/i).length).toBeGreaterThan(0);
    const panelFlights = screen
      .getAllByRole("link", { name: /domain\.flight/i })
      .find((el) => el.className.includes("pl-"));
    expect(panelFlights).toBeTruthy();
  });

  it("renders the System group with Einstellungen in the panel", () => {
    render(
      <MemoryRouter>
        <NavigationBar />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByLabelText(/toggleMenu/i));
    expect(
      screen.getAllByRole("link", { name: /dashboard:settings/i }).length
    ).toBeGreaterThan(0);
  });
});
