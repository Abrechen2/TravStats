import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FlightsTablePage from "../../pages/FlightsTablePage";
import { flightsApi, tripsApi } from "../../lib/api";

/**
 * FlightsTablePage pulls in many heavy siblings (filters, modals, table
 * cells). None of them matter for this test — only the header's link to
 * the central import hub does — so every sibling is stubbed at the module
 * boundary, following the CruisesPage.test.tsx convention.
 */
vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-bar-stub" />,
}));

vi.mock("../../components/Filters", () => ({
  default: () => <div data-testid="filters-stub" />,
}));

vi.mock("../../components/SimplifiedFlightFormV2", () => ({
  default: () => <div data-testid="add-flight-form-stub" />,
}));

vi.mock("../../components/SpecialFlightModal", () => ({
  default: () => <div data-testid="special-flight-modal-stub" />,
}));

vi.mock("../../components/FlightEditModal", () => ({
  default: () => <div data-testid="flight-edit-modal-stub" />,
}));

vi.mock("../../components/Training/ConfirmModal", () => ({
  default: () => <div data-testid="confirm-modal-stub" />,
}));

vi.mock("../../components/SkeletonLoader", () => ({
  SkeletonTable: () => <div data-testid="skeleton-table-stub" />,
}));

// Mock framer-motion to avoid animation-triggered state updates outside
// act() — PageTransition wraps every page in a motion.div.
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: (...args: unknown[]) => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

vi.mock("../../lib/api", () => ({
  flightsApi: {
    getAll: vi.fn(),
  },
  tripsApi: {
    getAll: vi.fn(),
  },
}));

describe("FlightsTablePage", () => {
  it("links to the central import hub in settings", async () => {
    vi.mocked(flightsApi.getAll).mockResolvedValue({
      flights: [],
      total: 0,
      limit: 100,
      offset: 0,
    });
    vi.mocked(tripsApi.getAll).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <FlightsTablePage />
      </MemoryRouter>
    );

    const link = await screen.findByRole("link", { name: /settings:import.openHub/ });
    expect(link.getAttribute("href")).toBe("/settings/data?section=import");
  });
});
