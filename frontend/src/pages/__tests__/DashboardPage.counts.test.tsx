import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";

/**
 * Tester report (2026-09-17, alex-design-feedback task 2): the count badge
 * behind a domain name in the tab strip disappears briefly on every tab
 * change, so the strip jumps.
 *
 * Cause: `App.tsx` keys its animated `Routes` on `location.pathname`, and
 * `/dashboard/flights` -> `/dashboard/cruises` is a pathname change, so
 * `DashboardPage` (and its `counts` state) remounts on every tab switch.
 * `DomainTabStrip` renders the badge whenever a count is not null, so the
 * remount's zeroed initial state shows briefly before the refetch resolves.
 *
 * This test reproduces the App.tsx remount mechanism directly (a `Routes`
 * keyed on `location.pathname`, exactly like App.tsx:251) rather than
 * mocking it away, so it actually exercises the remount that causes the bug.
 */

vi.mock("../../hooks/useClearMapSelectionsOnTabChange", () => ({
  useClearMapSelectionsOnTabChange: () => {},
}));

const flightsTotal = vi.hoisted(() => 42);

vi.mock("../../lib/api/flights", () => ({
  flightsApi: {
    getAll: vi.fn().mockResolvedValue({ total: flightsTotal, items: [] }),
  },
}));
vi.mock("../../lib/api/cruise", () => ({
  cruiseApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../lib/api/lodging", () => ({
  getLodgingStats: vi.fn().mockResolvedValue({ lodgingsCount: 0 }),
}));
vi.mock("../../lib/api/places", () => ({
  placesApi: { count: vi.fn().mockResolvedValue(0) },
}));
// DashboardLayout (the wrapper DashboardPage always renders) fetches this
// on mount -- unmocked, it fires a real, always-failing XHR in jsdom.
vi.mock("../../lib/api/upcoming", () => ({
  getUpcoming: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../components/Dashboard/tabs/AllTab", () => ({
  AllTab: () => <div data-testid="all-tab" />,
}));
vi.mock("../../components/Dashboard/tabs/FlightsTab", () => ({
  FlightsTab: () => <div data-testid="flights-tab" />,
}));
vi.mock("../../components/Dashboard/tabs/CruisesTab", () => ({
  CruisesTab: () => <div data-testid="cruises-tab" />,
}));
vi.mock("../../components/Dashboard/tabs/PoiTab", () => ({
  PoiTab: () => <div data-testid="poi-tab" />,
}));
vi.mock("../../components/Dashboard/tabs/LodgingTab", () => ({
  LodgingTab: () => <div data-testid="lodging-tab" />,
}));
vi.mock("../../components/Dashboard/tabs/TourTab", () => ({
  TourTab: () => <div data-testid="tour-tab" />,
}));

// NavigationBar asks for the running version on mount; the request escaped
// the test and failed silently (forgejo#110).
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

vi.unmock("../../store/settingsStore");

// Imported after the mocks above so the module graph picks them up.
import DashboardPage from "../DashboardPage";
import { useSettingsStore } from "../../store/settingsStore";
import { useDashboardCountsStore } from "../../store/dashboardCountsStore";

/** Mirrors App.tsx:249-251 -- the actual remount mechanism under test. */
function AnimatedDashboardRoutes(): JSX.Element {
  const location = useLocation();
  return (
    <Routes location={location} key={location.pathname}>
      <Route path="/dashboard/:tab" element={<DashboardPage />} />
    </Routes>
  );
}

function NavigateButton({ to }: { to: string }): JSX.Element {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      go-{to}
    </button>
  );
}

function renderDashboard(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={["/dashboard/flight"]}>
      {/* Sits beside the keyed Routes, same as App.tsx's other chrome --
          proves navigation works without depending on anything inside the
          remounted tree. */}
      <NavigateButton to="/dashboard/cruise" />
      <AnimatedDashboardRoutes />
    </MemoryRouter>
  );
}

// The test setup's global `react-i18next` mock returns the translation key
// verbatim (see `src/__tests__/setup.ts`), so the tab's accessible name is
// the raw i18n key rather than the German label a real render would show.
function flightBadge(): HTMLElement {
  const tab = screen.getByRole("tab", { name: /tabStrip\.tabs\.flight/i });
  return within(tab).getByText(String(flightsTotal));
}

beforeEach(() => {
  useSettingsStore.setState({
    enabledDomains: ["flight", "cruise", "lodging", "poi"],
    betaFeaturesEnabled: true,
  });
  useDashboardCountsStore.getState().reset();
});

describe("DashboardPage: tab strip counts survive a tab change", () => {
  it("keeps showing the loaded flight count across a tab switch instead of flashing to zero", async () => {
    renderDashboard();

    // Wait for the initial count fetch to resolve on /dashboard/flight.
    await waitFor(() => expect(flightBadge()).toBeInTheDocument());

    // A plain `fireEvent.click` (RTL wraps it in a SYNCHRONOUS `act`, not an
    // async one) flushes the navigation, the `Routes` remount and the first
    // render of the new `DashboardPage` -- but deliberately does NOT flush
    // the mocked APIs' promise microtasks. That is the exact instant the bug
    // lives in: if `counts` were local `useState`, this render would already
    // show the zeroed initial state, one tick before the refetch resolves.
    fireEvent.click(screen.getByRole("button", { name: "go-/dashboard/cruise" }));

    expect(flightBadge()).toBeInTheDocument();

    // Drain the refetch that the remounted DashboardPage kicked off, so no
    // state update lands after this test has already returned.
    await waitFor(() => expect(flightBadge()).toBeInTheDocument());
  });
});
