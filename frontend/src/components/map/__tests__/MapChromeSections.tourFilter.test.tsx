import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The year filter used to be hidden on the tour tab because `useDashboardTours` takes no date
 * param, so the select visibly did nothing (L2, fix round 1 review, 2026-08-30). The tabs now
 * filter their routes client-side by the tour's dates (the rule the "Alle" tab already used), so
 * the select is offered on every tab and `/dashboard/tour?year=2024` means something.
 */

const mockUseDashboardRoute = vi.hoisted(() => vi.fn());
vi.mock("../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => mockUseDashboardRoute(),
}));

vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: ["flight", "cruise", "lodging", "poi"],
    isEnabled: () => true,
  }),
}));

// Imported after the mocks above so the module graph picks them up.
import { MapChromeSections } from "../MapChromeSections";

function renderAt(tab: string, mode: string): ReturnType<typeof render> {
  mockUseDashboardRoute.mockReturnValue({ tab, mode, setTab: vi.fn(), setMode: vi.fn() });
  return render(<MapChromeSections />);
}

describe("MapChromeSections: the Filter section on the tour tab", () => {
  it("offers the year filter on the tour tab, which now filters by it", () => {
    renderAt("tour", "routes");
    expect(screen.getByText("dashboard:filter.title")).toBeInTheDocument();
    expect(screen.getByText("dashboard:filter.year")).toBeInTheDocument();
  });

  it("still offers the Modus section on the tour tab", () => {
    renderAt("tour", "routes");
    expect(screen.getByText("dashboard:controls.mode")).toBeInTheDocument();
  });

  it("keeps the year filter on a real domain tab (flight)", () => {
    renderAt("flight", "routes");
    expect(screen.getByText("dashboard:filter.title")).toBeInTheDocument();
    expect(screen.getByText("dashboard:filter.year")).toBeInTheDocument();
  });
});
