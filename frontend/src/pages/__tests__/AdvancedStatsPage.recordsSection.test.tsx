import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The flight tab really mounts Rekorde, and the section switch really hides it.
 *
 * `RecordsSection` has its own tests, and every one of them would stay green
 * with the line that mounts it deleted — a finished section nobody can reach.
 * This renders the page and looks for it, which is the assertion that fails
 * when the wiring goes.
 *
 * The section itself is stubbed. What is under test is the page's decision to
 * draw it, not its content, and a stub keeps this test from failing for
 * reasons that belong to the other file.
 */

vi.mock("../../components/Stats/RecordsSection", () => ({
  default: () => <div data-testid="records-section" />,
}));

const hidden = new Set<string>();
vi.mock("../../hooks/useSectionVisibility", () => ({
  useSectionVisibility: () => ({
    isVisible: (key: string) => !hidden.has(key),
    toggle: vi.fn(),
    reset: vi.fn(),
    hiddenCount: hidden.size,
  }),
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight"], isEnabled: (d: string) => d === "flight" }),
}));
vi.mock("../../hooks/usePlacesVisible", () => ({
  usePlacesAccess: () => "denied",
  usePlacesVisible: () => false,
}));

// Inline, not a module constant: `vi.mock` is hoisted above every `const` in
// this file, so a factory that closes over one reads it before it exists.
vi.mock("../../lib/api", () => ({
  flightsApi: {
    getAll: vi.fn().mockResolvedValue({
      flights: [
        {
          id: "f1",
          userId: "u1",
          airline: "Lufthansa",
          flightNumber: "LH 123",
          depIata: "MUC",
          depLat: 48,
          depLon: 11,
          arrIata: "SIN",
          arrLat: 1,
          arrLon: 103,
          departureTime: "2024-03-07T09:00:00.000Z",
          arrivalTime: "2024-03-07T21:00:00.000Z",
          status: "flown",
          createdAt: "2024-03-01T00:00:00.000Z",
        },
      ],
    }),
  },
  statsApi: {
    getSummary: vi.fn().mockResolvedValue({}),
    getTimeseries: vi.fn().mockResolvedValue({ series: [] }),
  },
}));
vi.mock("../../lib/api/achievements", () => ({
  achievementsApi: { getAll: vi.fn().mockResolvedValue(null) },
}));
vi.mock("../../lib/stats/useStatsPageSections", () => ({
  useStatsPageSections: () => ({ sections: {}, error: null, reload: vi.fn() }),
}));
// `{}`, not null: the page feeds this straight into `collectYears`, which
// walks it with `Object.entries`.
vi.mock("../../lib/stats/domain-stats", () => ({
  useDomainStats: () => ({ stats: {}, loading: false }),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

// The loading globe paints on a canvas, which jsdom does not implement. It is
// scenery here, and leaving it in only fills the run's stderr.
vi.mock("../../components/GlobeLoader", () => ({
  GlobeLoader: () => <div data-testid="globe-stub" />,
}));

// The suite's global settings stub carries display preferences only; this page
// reads `features.enableCostTracking` off the store as well. The real store
// has both and needs no network to say so.
vi.unmock("../../store/settingsStore");

import AdvancedStatsPage from "../AdvancedStatsPage";

const renderFlightTab = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={["/stats?tab=flight"]}>
      <AdvancedStatsPage />
    </MemoryRouter>
  );

describe("AdvancedStatsPage — the Rekorde section", () => {
  beforeEach(() => {
    hidden.clear();
  });

  it("mounts it on the flight tab", async () => {
    renderFlightTab();
    await waitFor(() => expect(screen.getByTestId("records-section")).toBeTruthy(), {
      timeout: 3000,
    });
  });

  it("leaves it out once the reader has switched the section off", async () => {
    hidden.add("records");
    renderFlightTab();

    // The flight tab has finished loading — asserted through a line it draws
    // unconditionally, so "not there" cannot silently mean "not there YET".
    await waitFor(() => expect(screen.getByText("stats:overview.scopeLabel")).toBeTruthy(), {
      timeout: 3000,
    });
    expect(screen.queryByTestId("records-section")).toBeNull();
  });
});
